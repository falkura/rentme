"""Local web server: JSON API + the built React app (rentme/static)."""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import hmac

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .chat import ChatError, ChatService
from .config import MODELS, Config
from .db import DB
from .http import Http
from .models import Listing
from .pipeline import Stopped, apply_filter, import_olx, make_sources, rank, refilter, update
from .sources.otodom import CITY_PATHS
from .tags import TAGS

STATIC = Path(__file__).parent / "static"


def row_to_card(r) -> dict[str, Any]:
    d = json.loads(r["data"])
    return {
        "uid": r["uid"], "source": r["source"], "url": d["url"], "title": d["title"],
        "price": d["price"], "admin_fee": d["admin_fee"], "total_price": d["total_price"],
        "deposit": d["deposit"], "area_m2": d["area_m2"], "rooms": d["rooms"], "floor": d["floor"],
        "location": d["location"], "author_name": d["author_name"], "author_type": d["author_type"],
        "tags": d["tags"], "created_at": d["created_at"], "available_from": d["available_from"],
        "image_count": len(d["image_urls"]), "thumb": (d["image_urls"] or [None])[0],
        "first_seen": r["first_seen"], "active": bool(r["active"]), "status": r["status"],
        "filter_ok": r["filter_ok"], "filter_reason": r["filter_reason"],
        "has_details": bool(r["has_details"]),
        "ai_score": r["ai_score"], "ai": json.loads(r["ai_json"]) if r["ai_json"] else None,
        "fingerprint": r["fingerprint"], "note": r["note"] or "",
        "added_by_link": bool(d.get("extra", {}).get("added_by_link")),
    }


LOOPBACK = {"127.0.0.1", "::1", "localhost"}
COOKIE = "rentme_key"


def create_app(cfg: Config, access_token: str | None = None) -> FastAPI:
    app = FastAPI(title="rentme")

    if access_token:
        # LAN mode: this computer is trusted; other devices must open the link with ?key=… once,
        # which stores the key in a cookie for a year.
        @app.middleware("http")
        async def require_key(request: Request, call_next):
            if (request.client.host if request.client else "") in LOOPBACK:
                return await call_next(request)
            given = request.query_params.get("key")
            if given is not None and hmac.compare_digest(given, access_token):
                resp = RedirectResponse(request.url.path or "/", status_code=303)
                resp.set_cookie(COOKIE, access_token, max_age=365 * 24 * 3600, httponly=True, samesite="lax")
                return resp
            if hmac.compare_digest(request.cookies.get(COOKIE, ""), access_token):
                return await call_next(request)
            return HTMLResponse(
                "<meta name=viewport content='width=device-width'><body style='font:16px system-ui;padding:24px'>"
                "<h3>rentme: access key needed</h3><p>Open the full link printed in the terminal on your computer "
                "(it ends with <code>?key=…</code>). You only need to do this once per device.</p>", status_code=401)
    db = DB(cfg.db_path)
    lock = threading.Lock()
    job: dict[str, Any] = {"running": False, "log": [], "stopping": False}
    stop_flag = threading.Event()  # defined before ChatService, which starts jobs too

    def fetch_details(l: Listing) -> Listing:
        src = make_sources(cfg, Http(delay=0.2)).get(l.source)
        if src:
            l = src.fetch_details(l)
            with lock:
                db.save_details(l)
                db.commit()
        return l

    def start_job(fn) -> bool:
        """Run fn(log, stop) in the background as THE update job (one at a time; progress in the top bar)."""
        if job["running"]:
            return False
        job.update(running=True, log=[], stopping=False)
        stop_flag.clear()

        def work():
            try:
                fn(job["log"].append, stop_flag.is_set)
                job["log"].append("Done.")
            except Stopped:
                job["log"].append("Stopped. Everything fetched so far is saved.")
            except Exception as e:
                job["log"].append(f"ERROR: {e!r}")
            finally:
                job.update(running=False, stopping=False)
        threading.Thread(target=work, daemon=True).start()
        return True

    chat = ChatService(cfg, db, lock, fetch_details, start_job=start_job, job_running=lambda: job["running"])

    # ---------- meta & settings ----------
    @app.get("/api/meta")
    def meta():
        return {"tags": TAGS, "cities": sorted(CITY_PATHS), "models": MODELS}

    @app.get("/api/settings")
    def get_settings():
        return {"config": cfg.to_dict(), "api_key": cfg.api_key_status()}

    @app.put("/api/settings")
    def put_settings(config: dict[str, Any] = Body(...)):
        try:
            new = Config.from_dict(config, cfg.path)
        except TypeError as e:
            raise HTTPException(400, f"invalid settings: {e}")
        cfg.filters, cfg.sources, cfg.ai, cfg.scrape = new.filters, new.sources, new.ai, new.scrape
        cfg.save()
        with lock:
            n = refilter(cfg, db)
        return {"ok": True, "refiltered": n, "config": cfg.to_dict()}

    @app.put("/api/settings/api-key")
    def put_key(key: str = Body("", embed=True)):
        cfg.set_api_key(key or None)
        return cfg.api_key_status()

    @app.post("/api/settings/test-key")
    def test_key():
        import anthropic
        k = cfg.api_key()
        if not k:
            return {"ok": False, "error": "No key set"}
        try:
            anthropic.Anthropic(api_key=k).models.retrieve(cfg.ai.get("model", "claude-opus-5-5"))
            return {"ok": True}
        except anthropic.AuthenticationError:
            return {"ok": False, "error": "Key rejected (401)"}
        except anthropic.NotFoundError:
            return {"ok": False, "error": "Key works, but this model is not available to your account"}
        except anthropic.APIError as e:
            return {"ok": False, "error": str(e)}

    # ---------- listings ----------
    @app.get("/api/listings")
    def listings(include_filtered: bool = False, include_inactive: bool = False, uids: str | None = Query(None)):
        where, params = ["1=1"], []
        if uids:
            ids = [u for u in uids.split(",") if u][:100]
            where.append(f"uid IN ({','.join('?' * len(ids))})")
            params += ids
        else:
            if not include_filtered:
                where.append("filter_ok=1")
            if not include_inactive:
                where.append("active=1")
        with lock:
            rows = db.rows(" AND ".join(where), tuple(params))
        cards = [row_to_card(r) for r in rows]
        # mark the weaker copy of a flat posted on several platforms
        cards.sort(key=lambda c: (c["ai_score"] is None, -(c["ai_score"] or 0), c["first_seen"]))
        first: dict[str, str] = {}
        for c in cards:
            fp = c.pop("fingerprint")
            c["duplicate_of"] = first.get(fp) if fp and not fp.startswith("0|0") else None
            if fp and c["duplicate_of"] is None:
                first[fp] = c["uid"]
        return cards

    @app.get("/api/listings/{uid}")
    def detail(uid: str):
        with lock:
            l = db.listing(uid)
        if not l:
            raise HTTPException(404)
        if l.description is None:
            l = fetch_details(l)
        return {"description": l.description, "raw_tags": l.raw_tags, "location": l.location.__dict__}

    @app.get("/api/listings/{uid}/open")
    def open_listing(uid: str):
        """Stable link for a listing id: redirects to the original page on otodom/olx."""
        with lock:
            l = db.listing(uid)
        if not l:
            raise HTTPException(404, f"Listing {uid} is not in the local database")
        return RedirectResponse(l.url, status_code=302)

    @app.get("/api/listings/{uid}/images")
    def images(uid: str):
        with lock:
            l = db.listing(uid)
        if not l:
            raise HTTPException(404)
        if l.description is None:  # list pages carry only a few photos; details have all
            l = fetch_details(l)
        return l.image_urls

    @app.put("/api/listings/{uid}/note")
    def set_note(uid: str, note: str = Body("", embed=True)):
        with lock:
            if not db.get(uid):
                raise HTTPException(404)
            db.set_note(uid, note[:5000])
            db.commit()
        return {"ok": True, "note": note.strip()}

    @app.post("/api/listings/by-url")
    def by_url(url: str = Body(..., embed=True)):
        """Find a listing by its link; if it's an Otodom link we don't have yet, fetch and add it."""
        url = url.strip()
        host = url.split("/")[2].lower() if url.count("/") >= 2 else ""
        with lock:
            row = db.find_by_url(url)
        if row and (row["active"] or not host.endswith("otodom.pl")):
            return {"found": "existing", "listing": row_to_card(row)}
        if host.endswith("olx.pl"):
            raise HTTPException(422, "Not in your listings yet, and OLX blocks automatic fetching. Use "
                                     "Settings → Import from OLX to bring OLX offers in.")
        if not host.endswith("otodom.pl"):
            raise HTTPException(400, "Paste a link to an otodom.pl or olx.pl offer")
        from .http import BlockedError
        from .sources import Otodom
        try:
            l = Otodom(Http(delay=0.2)).fetch_by_url(url)
        except BlockedError as e:
            raise HTTPException(502, f"Otodom refused the request ({e}). Try again later.")
        except (ValueError, KeyError, RuntimeError) as e:
            raise HTTPException(422, f"Could not read that Otodom page: {e}")
        l.extra["added_by_link"] = True
        with lock:
            # a stored copy marked "gone" (it dropped out of your search results) comes back to life;
            # its status, note and AI score are kept
            old = row or db.get(l.uid)
            if old:
                l = Listing(**{**l.__dict__, "source_id": old["uid"].split(":", 1)[1]})
            _, is_new = db.upsert_seen(l)
            db.save_details(l)
            apply_filter(db, cfg.filters, l)
            db.commit()
            row = db.get(l.uid)
        return {"found": "added" if is_new else "existing", "listing": row_to_card(row)}

    @app.post("/api/listings/{uid}/status")
    def set_status(uid: str, status: str = Body(..., embed=True)):
        if status not in ("new", "seen", "favorite", "rejected"):
            raise HTTPException(400, "bad status")
        with lock:
            db.set_status(uid, status)
            db.commit()
        return {"ok": True}

    # ---------- update job ----------
    @app.post("/api/update")
    def run_update(ai: bool = True, scrape: bool = True):
        if scrape:
            fn = lambda log, stop: update(cfg, use_ai=ai, log=log, stop=stop)
        else:  # AI ranking only, e.g. right after an OLX import
            fn = lambda log, stop: rank(cfg, DB(cfg.db_path), log, stop=stop)
        return {"started": start_job(fn)}

    # ---------- re-review: score every "new" listing again from scratch ----------
    NEW_WHERE = "active=1 AND filter_ok=1 AND status='new'"

    @app.get("/api/rescore-new")
    def rescore_new_count():
        with lock:
            rows = db.rows(NEW_WHERE)
        return {"count": len(rows), "without_details": sum(1 for r in rows if not r["has_details"]),
                "model": cfg.ai.get("model")}

    @app.post("/api/rescore-new")
    def rescore_new():
        def fn(log, stop):
            jdb = DB(cfg.db_path)
            rows = jdb.rows(NEW_WHERE)
            missing = [Listing.from_dict(json.loads(r["data"])) for r in rows if not r["has_details"]]
            if missing:
                log(f"fetching details for {len(missing)} new listings first...")
                sources = make_sources(cfg, Http(delay=float(cfg.scrape.get("delay", 1.5))))
                for l in missing:
                    if stop():
                        raise Stopped
                    src = sources.get(l.source)
                    try:
                        if src:
                            l = src.fetch_details(l)
                            jdb.save_details(l)
                            apply_filter(jdb, cfg.filters, l)
                    except Exception as e:  # one broken page must not stop the run
                        log(f"  ! {l.url}: {e}")
                jdb.commit()
            uids = [r["uid"] for r in jdb.rows(NEW_WHERE)]
            log(f"AI: re-reviewing all {len(uids)} new listings (old scores are replaced)")
            rank(cfg, jdb, log, force=True, stop=stop, uids=uids, limit=len(uids) or 1)
        return {"started": start_job(fn)}

    # ---------- OLX manual import (OLX blocks scripts; your own browser can open these links) ----------
    @app.get("/api/olx/urls")
    def olx_urls():
        from .sources import Olx
        o = Olx(Http(), cfg.sources.get("olx_city_id") or None)
        return {"urls": [o.api_url(cfg.filters, page * 40) for page in range(max(1, cfg.filters.max_pages))]}

    @app.post("/api/olx/import")
    def olx_import(data: Any = Body(...)):
        try:
            with lock:
                return import_olx(cfg, db, data)
        except (ValueError, KeyError, TypeError) as e:
            raise HTTPException(400, f"This doesn't look like a saved OLX page: {e}")

    @app.post("/api/update/stop")
    def stop_update():
        if job["running"]:
            stop_flag.set()
            job["stopping"] = True
            job["log"].append("Stopping after the current step…")
        return {"stopping": job["running"]}

    @app.get("/api/update")
    def update_status():
        return job

    # ---------- chat ----------
    @app.post("/api/chat")
    def chat_send(message: str = Body(...), session_id: str | None = Body(None)):
        try:
            return chat.send(session_id, message)
        except ChatError as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    @app.get("/api/chat/{session_id}")
    def chat_history(session_id: str):
        h = chat.history(session_id)
        if h is None:
            raise HTTPException(404, "no such chat")
        return {"session_id": session_id, "messages": h, **(chat.meta(session_id) or {})}

    @app.get("/api/chats")
    def saved_chats():
        return chat.list_saved()

    @app.put("/api/chat/{session_id}/save")
    def save_chat(session_id: str, title: str | None = Body(None, embed=True), saved: bool = Body(True, embed=True)):
        try:
            return chat.save_chat(session_id, title, saved)
        except KeyError as e:
            raise HTTPException(404, str(e))

    @app.post("/api/chat/{session_id}/filters/{change_id}")
    def chat_filter_action(session_id: str, change_id: str, action: str = Body(..., embed=True)):
        if action not in ("apply", "dismiss", "undo"):
            raise HTTPException(400, "action must be apply, dismiss or undo")
        try:
            return chat.filter_action(session_id, change_id, action)
        except KeyError as e:
            raise HTTPException(404, str(e))
        except (ValueError, TypeError) as e:
            raise HTTPException(400, f"invalid filters: {e}")

    @app.delete("/api/chat/{session_id}")
    def chat_reset(session_id: str):
        chat.reset(session_id)
        return {"ok": True}

    # ---------- frontend ----------
    if (STATIC / "assets").exists():
        app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/")
    def index():
        f = STATIC / "index.html"
        if not f.exists():
            return JSONResponse({"error": "frontend not built: cd web && npm install && npm run build"}, 500)
        return FileResponse(f)

    return app
