"""SQLite storage. One row per listing; full Listing kept as JSON."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .models import Listing

SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
    uid TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    data TEXT NOT NULL,
    fingerprint TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'new',      -- new | seen | favorite | rejected
    filter_ok INTEGER,
    filter_reason TEXT,
    has_details INTEGER NOT NULL DEFAULT 0,
    ai_score INTEGER,
    ai_json TEXT,
    ai_hash TEXT,
    note TEXT
);
CREATE INDEX IF NOT EXISTS ix_listings_score ON listings(ai_score DESC);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def url_key(url: str) -> str:
    path = url.split("#")[0].split("?")[0].rstrip("/")
    return path.rsplit("/", 1)[-1].lower() if "/" in path else ""


def fingerprint(l: Listing) -> str:
    """Rough cross-platform identity: same price, area, rooms and district."""
    price = round((l.total_price or 0) / 50) * 50
    area = round(l.area_m2 or 0)
    return f"{price}|{area}|{l.rooms}|{(l.location.district or l.location.city or '').lower()}"


class DB:
    def __init__(self, path: str | Path):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)

    def get(self, uid: str) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM listings WHERE uid=?", (uid,)).fetchone()

    def listing(self, uid: str) -> Listing | None:
        row = self.get(uid)
        return Listing.from_dict(json.loads(row["data"])) if row else None

    def upsert_seen(self, l: Listing) -> tuple[Listing, bool]:
        """Insert a freshly scraped (list-level) listing, or refresh an existing one
        while keeping details already fetched. Returns (merged listing, is_new)."""
        row = self.get(l.uid)
        ts = now()
        if row is None:
            self.conn.execute(
                "INSERT INTO listings(uid, source, data, fingerprint, first_seen, last_seen, has_details)"
                " VALUES (?,?,?,?,?,?,?)",
                (l.uid, l.source, json.dumps(l.to_dict(), ensure_ascii=False), fingerprint(l), ts, ts,
                 int(l.description is not None)),
            )
            return l, True
        old = Listing.from_dict(json.loads(row["data"]))
        if old.description is not None and l.description is None:
            # keep detail-level fields, refresh list-level ones (price can change)
            old.price, old.admin_fee, old.title = l.price or old.price, l.admin_fee or old.admin_fee, l.title
            l = old
        self.conn.execute(
            "UPDATE listings SET data=?, fingerprint=?, last_seen=?, active=1 WHERE uid=?",
            (json.dumps(l.to_dict(), ensure_ascii=False), fingerprint(l), ts, l.uid),
        )
        return l, False

    def save_details(self, l: Listing) -> None:
        self.conn.execute(
            "UPDATE listings SET data=?, fingerprint=?, has_details=1 WHERE uid=?",
            (json.dumps(l.to_dict(), ensure_ascii=False), fingerprint(l), l.uid),
        )

    def set_filter(self, uid: str, ok: bool, reason: str) -> None:
        self.conn.execute("UPDATE listings SET filter_ok=?, filter_reason=? WHERE uid=?", (int(ok), reason, uid))

    def set_ai(self, uid: str, score: int, payload: dict[str, Any], h: str) -> None:
        self.conn.execute(
            "UPDATE listings SET ai_score=?, ai_json=?, ai_hash=? WHERE uid=?",
            (score, json.dumps(payload, ensure_ascii=False), h, uid),
        )

    def set_note(self, uid: str, note: str) -> None:
        self.conn.execute("UPDATE listings SET note=? WHERE uid=?", (note.strip() or None, uid))

    def find_by_url(self, url: str) -> sqlite3.Row | None:
        """Match a pasted link to a stored listing by its last path part (ignores ?query, /hpr/, language prefix)."""
        key = url_key(url)
        if not key:
            return None
        # otodom sometimes lists one ad under two ids: prefer the live, detailed, ranked copy
        for r in self.conn.execute("SELECT * FROM listings WHERE data LIKE ? ORDER BY active DESC, has_details DESC,"
                                   " ai_score IS NULL, first_seen", (f"%{key}%",)):
            if url_key(json.loads(r["data"])["url"]) == key:
                return r
        return None

    def set_status(self, uid: str, status: str) -> None:
        self.conn.execute("UPDATE listings SET status=? WHERE uid=?", (status, uid))

    def mark_inactive(self, source: str, seen: Iterable[str]) -> int:
        seen = set(seen)
        rows = self.conn.execute("SELECT uid, data FROM listings WHERE source=? AND active=1", (source,)).fetchall()
        gone = [r["uid"] for r in rows
                if r["uid"] not in seen and not json.loads(r["data"]).get("extra", {}).get("added_by_link")]
        self.conn.executemany("UPDATE listings SET active=0 WHERE uid=?", [(u,) for u in gone])
        return len(gone)

    def rows(self, where: str = "1=1", params: tuple = ()) -> list[sqlite3.Row]:
        return self.conn.execute(f"SELECT * FROM listings WHERE {where}", params).fetchall()

    def commit(self) -> None:
        self.conn.commit()
