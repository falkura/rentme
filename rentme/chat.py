"""AI chat over your listings database.

Claude gets tools to search the local DB, read full listings and mark them
(favorite / rejected). Conversations are kept server-side and every assistant
response is appended unchanged (including thinking blocks), as the API requires.
"""
from __future__ import annotations

import json
import re
import threading
import uuid
from dataclasses import asdict
from datetime import date
from typing import Any

import anthropic

from .config import MODELS, Config
from .db import DB, now
from .http import Http
from .models import Listing, SearchFilters
from .pipeline import count_unranked, rank, refilter
from .sources.otodom import CITY_PATHS
from .tags import TAGS

MAX_TOOL_ROUNDS = 8
UID_RE = re.compile(r"(?<![\w/])((?:otodom|olx):[0-9]+)")  # {{uid}}, {uid} or bare uid

SYSTEM = """You are a helpful apartment-hunting assistant for a person renting in Poland.
You work on a local database of rental listings scraped from otodom.pl and olx.pl
(listings are mostly in Polish; always answer in the language the user writes in).

What you can do, and how:
1. Find and compare listings: search_listings (structured filters + free-text `text`), then get_listing
   (up to 8 uids at once) to read full descriptions before claiming details (pets, costs, lease terms,
   condition). Never invent facts that are not in a listing. Point out hidden costs (czynsz, media,
   prowizja, kaucja) and red flags. Searches only cover listings already in the database.
2. Hide or star listings: set_listing_status with one or many uids. "rejected" = hidden from the user's
   Listings and from searches (reversible with "seen"); "favorite" = starred. Use it when the user asks to
   remove/hide/star/restore specific listings (e.g. "remove the one on Górczewska", "hide all without a
   balcony"): find the exact listings first, then list in your answer exactly which ones you changed.
3. Rate listings: rank_listings scores listings 0-100 against the user's preferences (summary, pros, cons,
   red flags), the same as "Update now" does. It costs API credits: only use it when the user asks to
   rate/score/rank. Without uids it scores all unscored listings that pass the filters.
4. Analyze starred (favorite) listings: search_listings with status="favorite" (limit 40), then
   get_listing on them, then compare: total monthly cost incl. czynsz and media, deposit, area and layout
   (room count, separate rooms for work), location and commute, condition, lease terms, red flags. End
   with a clear ranking, a recommendation, and what to ask each landlord.
5. Change settings: update_search_filters for search filters, update_settings for everything else
   (AI model/effort/limits, preferences text, sources, scraping). The saved search filters decide which
   stored listings count as matches AND what the next "Update now" downloads. Set user_asked=true only
   when the user's own words clearly ask for that change; otherwise it becomes a proposal the user applies
   with a button. Never claim a change was made unless the result says applied=true. To look beyond the
   filters without changing them, use search_listings with include_filtered_out=true.
6. If the user asks you to remember something for the future, call `remember`.

`user_note` on a listing is the user's own note (e.g. from a viewing or a call with the landlord). Treat it as
first-hand information that overrides the ad text, and take it into account when comparing or recommending.

Whenever you mention a specific listing, write its uid in double curly braces, e.g. {{{{otodom:12345}}}}.
The app turns these into clickable cards, so you do not need to repeat links, prices or photos in full.
Be concise: short intro, then the results with one line each.

Unified tags: {tags}

Saved search filters (prices are rent + admin fee in PLN; rooms 4 means 4+):
{filters}

Other app settings:
{settings}

The user's saved preferences (use them as defaults unless the user says otherwise):
{preferences}

Memory - standing instructions from the user. Always follow them:
{memory}
"""

TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_listings",
        "description": "Search rental listings stored in the local database. Returns compact rows sorted as requested. "
                       "All filters are optional; omit what you don't need.",
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Words to match in title/description/location/the user's notes (any language, case-insensitive). Multiple words = all must match."},
                "max_total_price": {"type": "number", "description": "Max rent + admin fee in PLN"},
                "min_total_price": {"type": "number"},
                "min_area": {"type": "number"},
                "max_area": {"type": "number"},
                "rooms": {"type": "array", "items": {"type": "integer"}, "description": "Allowed room counts; 4 means 4+"},
                "districts": {"type": "array", "items": {"type": "string"}, "description": "District names, e.g. Mokotów, Wola"},
                "required_tags": {"type": "array", "items": {"type": "string", "enum": list(TAGS)}},
                "excluded_tags": {"type": "array", "items": {"type": "string", "enum": list(TAGS)}},
                "min_ai_score": {"type": "integer"},
                "source": {"type": "string", "enum": ["otodom", "olx"]},
                "status": {"type": "string", "enum": ["any", "new", "seen", "favorite", "rejected", "not_rejected"]},
                "include_filtered_out": {"type": "boolean", "description": "Also include listings that fail the user's saved filters"},
                "sort": {"type": "string", "enum": ["score", "price", "price_per_m2", "newest", "area"]},
                "limit": {"type": "integer", "description": "Max rows (default 15, max 40)"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_listing",
        "description": "Get full listings: description, all fields, AI evaluation, status. Up to 8 at once (e.g. to "
                       "compare favorites). Fetches details from the site if not stored yet.",
        "input_schema": {
            "type": "object",
            "properties": {"uids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 8,
                                    "description": "Listing uids like otodom:12345"}},
            "required": ["uids"],
            "additionalProperties": False,
        },
    },
    {
        "name": "set_listing_status",
        "description": "Change listings' status. favorite = starred; rejected = hidden from the Listings view and "
                       "searches (reversible); seen = normal (use it to restore or unstar); new = unread. "
                       "Only for listings the user asked about.",
        "input_schema": {
            "type": "object",
            "properties": {
                "uids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 100},
                "status": {"type": "string", "enum": ["new", "seen", "favorite", "rejected"]},
            },
            "required": ["uids", "status"],
            "additionalProperties": False,
        },
    },
    {
        "name": "rank_listings",
        "description": "AI-score listings 0-100 against the user's preferences (summary, pros, cons, red flags), like "
                       "Update now does. Costs API credits: only when the user asks to rate/score/rank. Without uids: "
                       "all unscored listings that pass the saved filters (big batches run in the background with "
                       "progress in the top bar). With uids: just those, even if filters hide them.",
        "input_schema": {
            "type": "object",
            "properties": {
                "uids": {"type": "array", "items": {"type": "string"}, "maxItems": 30},
                "rescore": {"type": "boolean", "description": "Score the given uids again even if already scored"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "remember",
        "description": "Save a standing instruction or fact to the user's memory (used in all future chats). "
                       "Only when the user asks you to remember something.",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string", "description": "One short instruction, written in English"}},
            "required": ["text"],
            "additionalProperties": False,
        },
    },
    {
        "name": "update_search_filters",
        "description": "Change the user's saved search filters (the same ones as in Settings → Search). They control "
                       "which stored listings pass and what the next update downloads from otodom/olx. Pass only the "
                       "fields to change; use null to clear a limit. Lists replace the old list entirely.",
        "input_schema": {
            "type": "object",
            "properties": {
                "changes": {
                    "type": "object",
                    "properties": {
                        "city": {"type": "string", "enum": sorted(CITY_PATHS)},
                        "price_min": {"type": ["number", "null"], "description": "Min total monthly price (PLN)"},
                        "price_max": {"type": ["number", "null"], "description": "Max total monthly price incl. czynsz (PLN)"},
                        "area_min": {"type": ["number", "null"]},
                        "area_max": {"type": ["number", "null"]},
                        "rooms": {"type": "array", "items": {"type": "integer", "minimum": 1, "maximum": 4},
                                  "description": "Allowed room counts, 4 = 4+; [] = any"},
                        "private_only": {"type": "boolean"},
                        "required_tags": {"type": "array", "items": {"type": "string", "enum": list(TAGS)}},
                        "excluded_tags": {"type": "array", "items": {"type": "string", "enum": list(TAGS)}},
                        "excluded_districts": {"type": "array", "items": {"type": "string"},
                                               "description": "Districts to skip entirely, original Polish spelling, e.g. Bemowo"},
                        "exclude_keywords": {"type": "array", "items": {"type": "string"},
                                             "description": "Skip listings whose text contains any of these"},
                    },
                    "additionalProperties": False,
                },
                "reason": {"type": "string", "description": "One short sentence for the user, in their language"},
                "user_asked": {"type": "boolean",
                               "description": "true only if the user's latest message explicitly asks to change the filters"},
            },
            "required": ["changes", "reason", "user_asked"],
            "additionalProperties": False,
        },
    },
    {
        "name": "update_settings",
        "description": "Change app settings other than search filters (same as in Settings). Never the API key. "
                       "Pass only what changes. Changing ai.preferences means every listing gets re-scored on the "
                       "next update (costs credits) - mention that.",
        "input_schema": {
            "type": "object",
            "properties": {
                "changes": {
                    "type": "object",
                    "properties": {
                        "ai.model": {"type": "string", "enum": [m["id"] for m in MODELS],
                                     "description": "Used for ranking and chat; haiku is cheapest, opus best"},
                        "ai.effort": {"type": "string", "enum": ["low", "medium", "high"], "description": "Ranking effort"},
                        "ai.chat_effort": {"type": "string", "enum": ["low", "medium", "high"]},
                        "ai.enabled": {"type": "boolean", "description": "Rank listings with AI on update"},
                        "ai.batch_size": {"type": "integer", "minimum": 1, "maximum": 15},
                        "ai.max_per_run": {"type": "integer", "minimum": 1, "maximum": 500,
                                           "description": "Max listings scored per update (cost cap)"},
                        "ai.preferences": {"type": "string", "description": "Full new text of the user's preferences"},
                        "sources.otodom": {"type": "boolean"},
                        "sources.olx": {"type": "boolean", "description": "Automatic OLX search (usually blocked)"},
                        "sources.otodom_location": {"type": "string", "description": "Otodom location path override, '' = city"},
                        "scrape.delay": {"type": "number", "minimum": 0.5, "maximum": 30},
                        "scrape.max_details_per_run": {"type": "integer", "minimum": 1, "maximum": 500},
                        "search.max_pages": {"type": "integer", "minimum": 1, "maximum": 20,
                                             "description": "Result pages per source per update"},
                    },
                    "additionalProperties": False,
                },
                "reason": {"type": "string", "description": "One short sentence for the user, in their language"},
                "user_asked": {"type": "boolean",
                               "description": "true only if the user's latest message explicitly asks for this change"},
            },
            "required": ["changes", "reason", "user_asked"],
            "additionalProperties": False,
        },
    },
    {
        "name": "database_stats",
        "description": "Counts of listings, districts and price range in the database. Useful to understand what is available.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


class ChatError(RuntimeError):
    pass


class ChatService:
    def __init__(self, cfg: Config, db: DB, db_lock: threading.Lock, fetch_details,
                 start_job=None, job_running=lambda: False):
        self.cfg, self.db, self.lock, self.fetch_details = cfg, db, db_lock, fetch_details
        self.start_job, self.job_running = start_job, job_running
        self._pending_changes: list[dict[str, Any]] = []
        self._job_started = False
        with db_lock:
            db.conn.executescript(
                "CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, system TEXT, context TEXT,"
                " messages TEXT, display TEXT, updated TEXT)")
            cols = {r[1] for r in db.conn.execute("PRAGMA table_info(chat_sessions)")}
            if "title" not in cols:
                db.conn.execute("ALTER TABLE chat_sessions ADD COLUMN title TEXT")
            if "saved" not in cols:
                db.conn.execute("ALTER TABLE chat_sessions ADD COLUMN saved INTEGER NOT NULL DEFAULT 0")
            db.conn.commit()

    # ---------- tools ----------
    def _rows(self) -> list[tuple[Any, Listing]]:
        with self.lock:
            rows = self.db.rows()
        return [(r, Listing.from_dict(json.loads(r["data"]))) for r in rows]

    def tool_search(self, a: dict[str, Any]) -> dict[str, Any]:
        words = [w.lower() for w in (a.get("text") or "").split() if w]
        districts = [d.lower() for d in a.get("districts") or []]
        status = a.get("status") or "not_rejected"
        out = []
        for r, l in self._rows():
            if not r["active"]:
                continue
            if not a.get("include_filtered_out") and r["filter_ok"] == 0:
                continue
            if status == "not_rejected" and r["status"] == "rejected":
                continue
            if status not in ("any", "not_rejected") and r["status"] != status:
                continue
            tp = l.total_price
            if a.get("max_total_price") is not None and (tp is None or tp > a["max_total_price"]):
                continue
            if a.get("min_total_price") is not None and (tp is None or tp < a["min_total_price"]):
                continue
            if a.get("min_area") is not None and (l.area_m2 or 0) < a["min_area"]:
                continue
            if a.get("max_area") is not None and (l.area_m2 or 1e9) > a["max_area"]:
                continue
            if a.get("rooms") and (l.rooms is None or min(l.rooms, 4) not in a["rooms"]):
                continue
            if districts and (l.location.district or "").lower() not in districts:
                continue
            if any(t not in l.tags for t in a.get("required_tags") or []):
                continue
            if any(t in l.tags for t in a.get("excluded_tags") or []):
                continue
            if a.get("min_ai_score") is not None and (r["ai_score"] or 0) < a["min_ai_score"]:
                continue
            if a.get("source") and l.source != a["source"]:
                continue
            if words:
                hay = " ".join([l.title, l.description or "", l.location.label(), " ".join(l.tags), r["note"] or ""]).lower()
                if not all(w in hay for w in words):
                    continue
            ai = json.loads(r["ai_json"]) if r["ai_json"] else {}
            out.append({
                "uid": l.uid, "title": l.title, "total_price": tp, "area_m2": l.area_m2, "rooms": l.rooms,
                "location": l.location.label(), "author_type": l.author_type, "tags": l.tags,
                "ai_score": r["ai_score"], "ai_summary": ai.get("summary"), "status": r["status"],
                "published": (l.created_at or "")[:10], "has_description": l.description is not None,
                **({"user_note": r["note"]} if r["note"] else {}),
            })
        key = {
            "score": lambda x: -(x["ai_score"] or -1),
            "price": lambda x: x["total_price"] or 1e9,
            "price_per_m2": lambda x: (x["total_price"] or 1e9) / (x["area_m2"] or 1),
            "newest": lambda x: x["published"], "area": lambda x: -(x["area_m2"] or 0),
        }[a.get("sort") or "score"]
        out.sort(key=key, reverse=(a.get("sort") == "newest"))
        limit = max(1, min(int(a.get("limit") or 15), 40))
        return {"total_matches": len(out), "results": out[:limit]}

    def tool_get(self, a: dict[str, Any]) -> dict[str, Any]:
        uids = list(dict.fromkeys(a.get("uids") or ([a["uid"]] if a.get("uid") else [])))[:8]
        if len(uids) == 1:
            return self._get_one(uids[0], 6000)
        return {"listings": [self._get_one(u, 3000) for u in uids]}

    def _get_one(self, uid: str, max_desc: int) -> dict[str, Any]:
        with self.lock:
            row = self.db.get(uid)
        if not row:
            return {"uid": uid, "error": f"no listing {uid}"}
        l = Listing.from_dict(json.loads(row["data"]))
        if l.description is None:
            try:
                l = self.fetch_details(l)
            except Exception as e:
                return {"error": f"could not fetch details: {e}"}
        d = l.to_dict()
        d.pop("image_urls", None)
        d.pop("raw_tags", None)
        d["description"] = (d.get("description") or "")[:max_desc]
        d["ai_evaluation"] = json.loads(row["ai_json"]) if row["ai_json"] else None
        d["status"] = row["status"]
        if row["note"]:
            d["user_note"] = row["note"]
        return d

    def tool_status(self, a: dict[str, Any]) -> dict[str, Any]:
        uids = list(dict.fromkeys(a.get("uids") or ([a["uid"]] if a.get("uid") else [])))
        done, missing = [], []
        with self.lock:
            for uid in uids:
                if self.db.get(uid):
                    self.db.set_status(uid, a["status"])
                    done.append(uid)
                else:
                    missing.append(uid)
            self.db.commit()
        return {"updated": done, "status": a["status"], "not_found": missing}

    def tool_rank(self, a: dict[str, Any]) -> dict[str, Any]:
        if not self.cfg.api_key():
            return {"error": "no API key"}
        if self.job_running():
            return {"error": "An update/ranking job is already running (see the top bar). It ranks unscored listings "
                             "too; ask the user to wait for it to finish."}
        fresh = DB(self.cfg.db_path)  # own connection: scoring takes a while and must not block the app
        uids = list(dict.fromkeys(a.get("uids") or []))
        if uids:
            missing = []
            for uid in uids:
                row = fresh.get(uid)
                if not row:
                    missing.append(uid)
                elif not row["has_details"]:
                    try:
                        self.fetch_details(Listing.from_dict(json.loads(row["data"])))
                    except Exception:
                        pass
            res = rank(self.cfg, fresh, log=lambda *_: None, force=bool(a.get("rescore")), uids=uids, limit=len(uids))
            return {"scored": res, "not_found": missing,
                    "note": None if res or a.get("rescore") else "Already scored; pass rescore=true to score again."}
        n = count_unranked(fresh)
        cap = int(self.cfg.ai.get("max_per_run", 60))
        if n == 0:
            return {"scored": [], "note": "Every listing that passes the filters is already scored."}
        if n <= 12:
            return {"scored": rank(self.cfg, fresh, log=lambda *_: None, limit=n)}
        if not self.start_job:
            return {"error": "background jobs are not available here"}
        self.start_job(lambda log, stop: rank(self.cfg, DB(self.cfg.db_path), log, stop=stop))
        self._job_started = True
        return {"started_in_background": True, "will_score_now": min(n, cap), "unscored_total": n,
                "note": "Progress is shown in the top bar; scores appear in Listings as they arrive. "
                        + (f"Only {cap} per run (ai.max_per_run): run again for the rest, or raise the cap."
                           if n > cap else "")}

    def tool_stats(self, _a: dict[str, Any]) -> dict[str, Any]:
        rows = [(r, l) for r, l in self._rows() if r["active"]]
        ok = [(r, l) for r, l in rows if r["filter_ok"] == 1]
        districts: dict[str, int] = {}
        for _, l in ok:
            districts[l.location.district or "?"] = districts.get(l.location.district or "?", 0) + 1
        prices = sorted(l.total_price for _, l in ok if l.total_price)
        return {
            "active_listings": len(rows), "passing_saved_filters": len(ok),
            "ai_ranked": sum(1 for r, _ in ok if r["ai_score"] is not None),
            "favorites": sum(1 for r, _ in rows if r["status"] == "favorite"),
            "districts": dict(sorted(districts.items(), key=lambda x: -x[1])),
            "price_min": prices[0] if prices else None, "price_median": prices[len(prices) // 2] if prices else None,
            "price_max": prices[-1] if prices else None,
        }

    def run_tool(self, name: str, args: dict[str, Any]) -> tuple[str, bool]:
        fn = {"search_listings": self.tool_search, "get_listing": self.tool_get,
              "set_listing_status": self.tool_status, "database_stats": self.tool_stats,
              "remember": self.tool_remember, "update_search_filters": self.tool_filters,
              "update_settings": self.tool_settings, "rank_listings": self.tool_rank}.get(name)
        if not fn:
            return f"unknown tool {name}", True
        try:
            return json.dumps(fn(args or {}), ensure_ascii=False, default=str), False
        except Exception as e:
            return f"tool error: {e!r}", True

    # ---------- search filters ----------
    def _current(self, key: str) -> tuple[bool, Any]:
        """(known, value) for a filter key ("price_max") or a dotted settings key ("ai.model")."""
        if "." not in key:
            f = asdict(self.cfg.filters)
            return (key in f and key != "max_pages"), f.get(key)
        sec, field = key.split(".", 1)
        if sec == "search":
            f = asdict(self.cfg.filters)
            return field in f, f.get(field)
        d = {"ai": self.cfg.ai, "sources": self.cfg.sources, "scrape": self.cfg.scrape}.get(sec)
        if d is None or field == "chat_can_edit_filters":  # the AI may not widen its own permissions
            return False, None
        return True, d.get(field)

    def filter_diff(self, values: dict[str, Any]) -> dict[str, list[Any]]:
        out = {}
        for k, v in values.items():
            known, cur = self._current(k)
            if known and cur != v:
                out[k] = [cur, v]
        return out

    def apply_filters(self, values: dict[str, Any]) -> int:
        """Save new filter/settings values (re-checking stored listings when filters change);
        returns how many active listings pass the filters now."""
        search = {k.split(".", 1)[-1]: v for k, v in values.items() if "." not in k or k.startswith("search.")}
        other = {k: v for k, v in values.items() if "." in k and not k.startswith("search.")}
        if other.get("ai.model") is not None and other["ai.model"] not in {m["id"] for m in MODELS}:
            raise ValueError(f"unknown model {other['ai.model']!r}")
        for k, v in other.items():
            sec, field = k.split(".", 1)
            {"ai": self.cfg.ai, "sources": self.cfg.sources, "scrape": self.cfg.scrape}[sec][field] = v
        if not search:
            self.cfg.save()
            with self.lock:
                return self.db.conn.execute("SELECT COUNT(*) FROM listings WHERE filter_ok=1 AND active=1").fetchone()[0]
        merged = asdict(self.cfg.filters) | search
        if merged.get("city") not in CITY_PATHS:
            raise ValueError(f"unknown city {merged.get('city')!r}")
        if any(t not in TAGS for t in merged["required_tags"] + merged["excluded_tags"]):
            raise ValueError("unknown tag")
        merged["rooms"] = sorted({int(r) for r in merged["rooms"] if 1 <= int(r) <= 4})
        self.cfg.filters = SearchFilters(**merged)
        self.cfg.save()
        with self.lock:
            refilter(self.cfg, self.db)
            return self.db.conn.execute("SELECT COUNT(*) FROM listings WHERE filter_ok=1 AND active=1").fetchone()[0]

    def tool_settings(self, a: dict[str, Any]) -> dict[str, Any]:
        r = self.tool_filters(a)
        if r.get("applied") and "ai.preferences" in (r.get("changes") or {}):
            r["note"] = "Saved. The next update re-scores every listing against the new preferences (costs credits)."
        elif r.get("applied"):
            r["note"] = "Saved."
        return r

    def tool_filters(self, a: dict[str, Any]) -> dict[str, Any]:
        diff = self.filter_diff(a.get("changes") or {})
        if not diff:
            return {"applied": False, "note": "These values are already saved; nothing to change."}
        change = {"id": uuid.uuid4().hex[:8], "changes": diff, "reason": a.get("reason") or "", "state": "pending"}
        if self.cfg.ai.get("chat_can_edit_filters") or a.get("user_asked"):
            passing = self.apply_filters({k: v[1] for k, v in diff.items()})
            change["state"] = "applied"
            self._pending_changes.append(change)
            return {"applied": True, "changes": diff, "listings_passing_now": passing,
                    "note": "Saved. Stored listings were re-checked. Listings not downloaded yet arrive with the next "
                            "update; the user sees an 'Update now' button under your message, mention it briefly."}
        self._pending_changes.append(change)
        return {"applied": False, "status": "proposed", "changes": diff,
                "note": "Not applied: the user sees Apply/Dismiss buttons under your message. Tell them briefly what "
                        "you propose and why. Meanwhile you can search with include_filtered_out=true."}

    def filter_action(self, sid: str, change_id: str, action: str) -> dict[str, Any]:
        """The user clicked Apply / Dismiss / Undo on a filter change shown in the chat."""
        sess = self._load(sid)
        if not sess:
            raise KeyError("no such chat")
        for entry in sess["display"]:
            for ch in entry.get("filters") or []:
                if ch["id"] != change_id:
                    continue
                passing = None
                if action == "apply" and ch["state"] in ("pending", "dismissed", "undone"):
                    passing = self.apply_filters({k: v[1] for k, v in ch["changes"].items()})
                    ch["state"] = "applied"
                elif action == "undo" and ch["state"] == "applied":
                    passing = self.apply_filters({k: v[0] for k, v in ch["changes"].items()})
                    ch["state"] = "undone"
                elif action == "dismiss" and ch["state"] == "pending":
                    ch["state"] = "dismissed"
                self._save(sess)
                return {"change": ch, "passing": passing, "search": asdict(self.cfg.filters)}
        raise KeyError("no such change")

    def tool_remember(self, a: dict[str, Any]) -> dict[str, Any]:
        text = (a.get("text") or "").strip()
        if not text:
            return {"error": "empty"}
        mem = list(self.cfg.ai.get("memory") or [])
        if text not in mem:
            mem.append(text)
            self.cfg.ai["memory"] = mem
            self.cfg.save()
        return {"ok": True, "memory": mem}

    # ---------- persistence ----------
    def _load(self, sid: str) -> dict[str, Any] | None:
        with self.lock:
            r = self.db.conn.execute("SELECT * FROM chat_sessions WHERE id=?", (sid,)).fetchone()
        if not r:
            return None
        return {"id": r["id"], "system": r["system"], "context": r["context"],
                "messages": json.loads(r["messages"]), "display": json.loads(r["display"])}

    def _save(self, s: dict[str, Any]) -> None:
        with self.lock:
            self.db.conn.execute(
                "INSERT INTO chat_sessions(id, system, context, messages, display, updated) VALUES (?,?,?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET context=excluded.context, messages=excluded.messages, "
                "display=excluded.display, updated=excluded.updated",
                (s["id"], s["system"], s["context"], json.dumps(s["messages"], ensure_ascii=False),
                 json.dumps(s["display"], ensure_ascii=False), now()),
            )
            self.db.commit()

    def history(self, sid: str) -> list[dict[str, Any]] | None:
        s = self._load(sid)
        return s["display"] if s else None

    def list_saved(self) -> list[dict[str, Any]]:
        with self.lock:
            rows = self.db.conn.execute(
                "SELECT id, title, display, updated FROM chat_sessions WHERE saved=1 ORDER BY updated DESC").fetchall()
        return [{"id": r["id"], "title": r["title"] or "Untitled chat", "updated": r["updated"],
                 "messages": len(json.loads(r["display"]))} for r in rows]

    def save_chat(self, sid: str, title: str | None, saved: bool = True) -> dict[str, Any]:
        s = self._load(sid)
        if not s:
            raise KeyError("no such chat")
        if not (title or "").strip():
            first = next((m["text"] for m in s["display"] if m["role"] == "user"), "Untitled chat")
            title = first if len(first) <= 60 else first[:57].rstrip() + "…"
        with self.lock:
            self.db.conn.execute("UPDATE chat_sessions SET title=?, saved=? WHERE id=?",
                                 (title.strip(), int(saved), sid))
            self.db.commit()
        return {"id": sid, "title": title.strip(), "saved": saved}

    def meta(self, sid: str) -> dict[str, Any] | None:
        with self.lock:
            r = self.db.conn.execute("SELECT title, saved FROM chat_sessions WHERE id=?", (sid,)).fetchone()
        return {"title": r["title"], "saved": bool(r["saved"])} if r else None

    def reset(self, session_id: str) -> None:
        with self.lock:
            self.db.conn.execute("DELETE FROM chat_sessions WHERE id=?", (session_id,))
            self.db.commit()

    # ---------- conversation ----------
    def _context(self) -> tuple[list[str], str, str, str]:
        return (list(self.cfg.ai.get("memory") or []), self.cfg.ai.get("preferences", "").strip(),
                self._filters_text(), self._settings_text())

    def _settings_text(self) -> str:
        ai = {k: v for k, v in self.cfg.ai.items() if k not in ("preferences", "memory")}
        return json.dumps({"ai": ai, "sources": self.cfg.sources, "scrape": self.cfg.scrape,
                           "search.max_pages": self.cfg.filters.max_pages}, ensure_ascii=False)

    def _filters_text(self) -> str:
        f = asdict(self.cfg.filters)
        f.pop("max_pages", None)
        return json.dumps(f, ensure_ascii=False)

    @staticmethod
    def _memory_text(memory: list[str]) -> str:
        return "\n".join(f"- {m}" for m in memory) or "(empty)"

    def _build_system(self) -> str:
        memory, prefs, filters, settings = self._context()
        return (SYSTEM.format(tags=", ".join(TAGS), preferences=prefs, memory=self._memory_text(memory),
                              filters=filters, settings=settings)
                + f"\nToday is {date.today().isoformat()}.")

    def send(self, session_id: str | None, text: str) -> dict[str, Any]:
        key = self.cfg.api_key()
        if not key:
            raise ChatError("No Anthropic API key. Add it in Settings → AI.")
        sess = self._load(session_id) if session_id else None
        if sess is None:
            # the system prompt is frozen per conversation so the cached prefix and earlier
            # thinking blocks stay valid; later memory/preference edits go in as system notes
            sess = {"id": uuid.uuid4().hex, "system": self._build_system(),
                    "context": json.dumps(self._context(), ensure_ascii=False), "messages": [], "display": []}
        messages: list[dict[str, Any]] = sess["messages"]
        start = len(messages)
        messages.append({"role": "user", "content": text})

        ctx_now = json.dumps(self._context(), ensure_ascii=False)
        if ctx_now != sess["context"]:
            memory, prefs, filters, settings = self._context()
            messages.append({"role": "system", "content":
                "The user's saved settings changed (in Settings or via buttons in the chat). From now on use these.\n"
                f"Memory (always follow):\n{self._memory_text(memory)}\n\nPreferences:\n{prefs}\n\n"
                f"Saved search filters:\n{filters}\n\nOther settings:\n{settings}"})
            sess["context"] = ctx_now

        client = anthropic.Anthropic(api_key=key)
        model = self.cfg.ai.get("model", "claude-sonnet-5-5")
        system_blocks = [{"type": "text", "text": sess["system"], "cache_control": {"type": "ephemeral"}}]
        steps: list[dict[str, Any]] = []
        self._pending_changes = []
        self._job_started = False

        def call(**extra):
            try:
                return client.messages.create(model=model, system=system_blocks, tools=TOOLS,
                                              messages=messages, **extra)
            except anthropic.AuthenticationError:
                del messages[start:]
                raise ChatError("The API key was rejected. Check it in Settings → AI.")
            except anthropic.RateLimitError:
                del messages[start:]
                raise ChatError("Rate limited by the API, try again in a minute.")
            except anthropic.APIStatusError as e:
                del messages[start:]
                raise ChatError(f"API error {e.status_code}: {e.message}")
            except anthropic.APIConnectionError:
                del messages[start:]
                raise ChatError("Could not reach the Anthropic API (network).")

        def dump(content) -> list[dict[str, Any]]:
            return [b.model_dump(mode="json", exclude_none=True) if hasattr(b, "model_dump") else b
                    for b in content]

        for _ in range(MAX_TOOL_ROUNDS):
            resp = call(max_tokens=16000, output_config={"effort": self.cfg.ai.get("chat_effort", "medium")})
            # append exactly what the model returned (thinking blocks must stay unchanged)
            messages.append({"role": "assistant", "content": dump(resp.content)})
            if resp.stop_reason == "pause_turn":
                continue
            tool_uses = [b for b in resp.content if b.type == "tool_use"]
            if resp.stop_reason != "tool_use" or not tool_uses:
                break
            results: list[dict[str, Any]] = []
            for tu in tool_uses:
                out, is_err = self.run_tool(tu.name, tu.input)
                steps.append({"tool": tu.name, "input": tu.input})
                results.append({"type": "tool_result", "tool_use_id": tu.id, "content": out, "is_error": is_err})
                if tu.name in ("remember", "update_search_filters", "update_settings") and not is_err:
                    sess["context"] = json.dumps(self._context(), ensure_ascii=False)  # model already knows
            messages.append({"role": "user", "content": results})
        else:
            messages[-1]["content"].append({"type": "text", "text": "Stop using tools now and answer with what you have."})
            resp = call(max_tokens=8000, tool_choice={"type": "none"})
            messages.append({"role": "assistant", "content": dump(resp.content)})

        if resp.stop_reason == "refusal":
            answer = "The model declined to answer this request."
        else:
            answer = "\n".join(b.text for b in resp.content if b.type == "text").strip()
        mentioned = list(dict.fromkeys(UID_RE.findall(answer)))
        changes, self._pending_changes = self._pending_changes, []
        sess["display"] += [{"role": "user", "text": text},
                            {"role": "assistant", "text": answer, "uids": mentioned, "steps": steps, "filters": changes}]
        self._save(sess)
        return {"session_id": sess["id"], "answer": answer, "steps": steps, "listing_uids": mentioned,
                "filters": changes, "job_started": self._job_started}
