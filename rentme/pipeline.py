"""update = scrape lists -> local filter -> fetch details (descriptions) -> filter again -> AI rank."""
from __future__ import annotations

import json
from typing import Any

from .config import Config
from .db import DB
from .http import BlockedError, Http
from .models import Listing, SearchFilters
from .sources import Olx, Otodom
from . import tags as T

__all__ = ["Config", "update", "rank", "refilter", "make_sources", "apply_filter"]


def refilter(cfg: Config, db: DB | None = None) -> int:
    """Re-apply the local filters to every stored listing (after settings change)."""
    db = db or DB(cfg.db_path)
    rows = db.rows()
    for row in rows:
        apply_filter(db, cfg.filters, Listing.from_dict(json.loads(row["data"])))
    db.commit()
    return len(rows)


def import_olx(cfg: Config, db: DB, data: Any) -> dict[str, int]:
    """Import an OLX API response saved from your own browser (dict with "data", or a list of offers)."""
    from .sources import Olx
    raw = data.get("data") if isinstance(data, dict) else data
    if not isinstance(raw, list) or (raw and not any(isinstance(x, dict) and "id" in x for x in raw)):
        raise ValueError("no OLX offers found in it")
    items = list(Olx(Http(), None).parse_items([x for x in raw if isinstance(x, dict)]))
    new = passing = 0
    for item in items:
        item, is_new = db.upsert_seen(item)
        db.save_details(item)  # OLX API offers already include the full description
        new += is_new
        passing += apply_filter(db, cfg.filters, item)
    db.commit()
    return {"offers": len(raw), "imported": len(items), "otodom_mirrors_skipped": len(raw) - len(items),
            "new": new, "passing_filters": passing}


def make_sources(cfg: Config, http: Http) -> dict[str, Any]:
    s = cfg.sources
    out: dict[str, Any] = {}
    if s.get("otodom", True):
        out["otodom"] = Otodom(http, s.get("otodom_location") or None)
    if s.get("olx", True):
        out["olx"] = Olx(http, s.get("olx_city_id") or None)
    return out


def apply_filter(db: DB, f: SearchFilters, l: Listing) -> bool:
    ok, reason = f.matches(l)
    db.set_filter(l.uid, ok, reason)
    return ok


class Stopped(Exception):
    """The user pressed Stop. Work done so far is kept."""


def update(cfg: Config, use_ai: bool = True, log=print, stop=lambda: False) -> None:
    db = DB(cfg.db_path)
    try:
        _update(cfg, db, use_ai, log, stop)
    finally:
        db.commit()  # keep whatever was fetched before a stop or an error


def _update(cfg: Config, db: DB, use_ai: bool, log, stop) -> None:
    http = Http(delay=float(cfg.scrape.get("delay", 1.5)))
    f = cfg.filters
    sources = make_sources(cfg, http)

    # 1) list pages
    need_details: list[tuple[Any, Listing]] = []
    for name, src in sources.items():
        log(f"[{name}] searching...")
        seen, new = [], 0
        try:
            for l in src.search(f):
                if stop():  # before mark_inactive: a partial scan must not mark listings as gone
                    raise Stopped
                l, is_new = db.upsert_seen(l)
                seen.append(l.uid)
                new += is_new
                if apply_filter(db, f, l) and l.description is None:
                    need_details.append((src, l))
        except BlockedError as e:
            log(f"[{name}] blocked by the site ({e}). Skipping this source. "
                f"See README: 'OLX is blocked' for options.")
            db.commit()
            continue
        gone = db.mark_inactive(name, seen) if seen else 0
        db.commit()
        log(f"[{name}] {len(seen)} listings ({new} new, {gone} no longer listed)")

    # 2) details for listings that passed the cheap filter
    limit = int(cfg.scrape.get("max_details_per_run", 80))
    if need_details:
        log(f"fetching details for {min(len(need_details), limit)} of {len(need_details)} listings...")
    for i, (src, l) in enumerate(need_details[:limit], 1):
        if stop():
            raise Stopped
        try:
            l = src.fetch_details(l)
        except BlockedError as e:
            log(f"  blocked while fetching details: {e}")
            break
        except Exception as e:  # one broken page must not stop the run
            log(f"  ! {l.url}: {e}")
            continue
        db.save_details(l)
        apply_filter(db, f, l)
        if i % 10 == 0:
            db.commit()
            log(f"  {i} done")
    db.commit()

    # 3) AI ranking
    if use_ai and cfg.ai.get("enabled", True):
        rank(cfg, db, log, stop=stop)


def rank(cfg: Config, db: DB | None = None, log=print, force: bool = False, stop=lambda: False,
         uids: list[str] | None = None, limit: int | None = None) -> list[dict[str, Any]]:
    """AI-score listings. Default: every active, filter-passing, unscored (or changed) listing, up to
    ai.max_per_run. With `uids`: just those listings (even if your filters hide them). Returns the scores."""
    from .ai import Ranker  # imported lazily so scraping works without an API key

    db = db or DB(cfg.db_path)
    if not cfg.api_key():
        log("AI: no Anthropic API key (set it in Settings or ANTHROPIC_API_KEY), skipping ranking")
        return []
    prefs = cfg.ai.get("preferences", "").strip()
    if not prefs:
        log("AI: no [ai].preferences in config, skipping")
        return []
    ranker = Ranker(
        prefs,
        model=cfg.ai.get("model", "claude-sonnet-5-5"),
        effort=cfg.ai.get("effort", "low"),
        batch_size=int(cfg.ai.get("batch_size", 6)),
        api_key=cfg.api_key(),
    )
    todo: list[tuple[Listing, str]] = []
    if uids:
        rows = db.rows(f"has_details=1 AND uid IN ({','.join('?' * len(uids))})", tuple(uids))
    else:
        rows = db.rows("active=1 AND filter_ok=1 AND has_details=1 AND status!='rejected'")
    for row in rows:
        l = Listing.from_dict(json.loads(row["data"]))
        h = ranker.content_hash(l)
        if force or row["ai_hash"] != h:
            todo.append((l, h))
    todo = todo[: int(limit or cfg.ai.get("max_per_run", 60))]
    if not todo:
        log("AI: nothing new to rank")
        return []
    log(f"AI: ranking {len(todo)} listings with {ranker.model}...")
    hashes = {l.uid: h for l, h in todo}
    listings = {l.uid: l for l, _ in todo}
    results: list[dict[str, Any]] = []
    for i in range(0, len(todo), ranker.batch_size):
        if stop():
            raise Stopped
        chunk = [l for l, _ in todo[i:i + ranker.batch_size]]
        for r in ranker.evaluate(chunk):
            l = listings[r.uid]
            merged = T.normalize(l.tags + r.extra_tags)
            if merged != l.tags:
                l.tags = merged
                db.save_details(l)
            db.set_ai(r.uid, r.score, r.model_dump(), hashes[r.uid])
            results.append({"uid": r.uid, "score": r.score, "verdict": r.verdict, "summary": r.summary})
        db.commit()
        log(f"  {min(i + ranker.batch_size, len(todo))}/{len(todo)}")
    return results


def count_unranked(db: DB) -> int:
    """Listings that the next ranking run would score (ignoring the per-run cap)."""
    return db.conn.execute(
        "SELECT COUNT(*) FROM listings WHERE active=1 AND filter_ok=1 AND has_details=1 "
        "AND status!='rejected' AND ai_score IS NULL").fetchone()[0]
