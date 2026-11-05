"""OLX.pl adapter.

OLX's web app loads offers from a JSON endpoint (/api/v1/offers/) that already
includes the full description, params, location, user and photos, so no
per-offer detail request is needed.

NOTE: OLX sits behind a CloudFront bot filter that often answers 403 to
non-browser clients. This adapter does NOT try to evade that. If it is
blocked, it raises BlockedError and the pipeline continues with other sources.
You can still feed OLX data in manually: open the API URL printed by
`rentme olx-url` in your normal browser, save the JSON, then run
`rentme import-olx saved.json`.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator
from urllib.parse import urlencode

from ..http import Http
from ..models import Listing, Location, SearchFilters
from .otodom import html_to_text
from .. import tags as T

API = "https://www.olx.pl/api/v1/offers/"
CATEGORY_FLATS_RENT = 15  # Nieruchomości > Mieszkania > Wynajem

# OLX city ids (override with `olx_city_id` in config if your city is missing).
CITY_IDS = {
    "warszawa": 17871, "krakow": 8959, "wroclaw": 19701, "poznan": 13983,
    "gdansk": 5659, "lodz": 10609,
}
ROOMS = {"one": 1, "two": 2, "three": 3, "four": 4}
ROOMS_REV = {v: k for k, v in ROOMS.items()}
PAGE = 40


class Olx:
    name = "olx"

    def __init__(self, http: Http, city_id: int | None = None):
        self.http = http
        self.city_id = city_id

    def api_url(self, f: SearchFilters, offset: int = 0) -> str:
        q: list[tuple[str, str]] = [
            ("offset", str(offset)), ("limit", str(PAGE)),
            ("category_id", str(CATEGORY_FLATS_RENT)), ("sort_by", "created_at:desc"),
        ]
        city_id = self.city_id or CITY_IDS.get(f.city.lower())
        if city_id:
            q.append(("city_id", str(city_id)))
        if f.price_min is not None:
            q.append(("filter_float_price:from", str(int(f.price_min))))
        if f.price_max is not None:
            # OLX "price" excludes the admin fee, so this is only a coarse pre-filter;
            # the exact total-price check happens locally.
            q.append(("filter_float_price:to", str(int(f.price_max))))
        if f.area_min is not None:
            q.append(("filter_float_m:from", str(int(f.area_min))))
        if f.area_max is not None:
            q.append(("filter_float_m:to", str(int(f.area_max))))
        for i, r in enumerate(sorted(f.rooms)):
            q.append((f"filter_enum_rooms[{i}]", ROOMS_REV[min(r, 4)]))
        if f.private_only:
            q.append(("owner_type", "private"))
        return f"{API}?{urlencode(q)}"

    def search(self, f: SearchFilters) -> Iterator[Listing]:
        for page in range(f.max_pages):
            data = self.http.get(self.api_url(f, page * PAGE)).json()
            items = data.get("data") or []
            yield from self.parse_items(items)
            if len(items) < PAGE:
                break

    def import_file(self, path: str | Path) -> list[Listing]:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return list(self.parse_items(data.get("data", data if isinstance(data, list) else [])))

    def parse_items(self, items: list[dict]) -> Iterator[Listing]:
        for it in items:
            l = self._from_item(it)
            if l:
                yield l

    def fetch_details(self, l: Listing) -> Listing:
        return l  # API list already contains everything

    def _from_item(self, it: dict) -> Listing | None:
        partner = (it.get("partner") or {}).get("code")
        if partner == "otodom":
            return None  # mirror of an otodom ad; we get it from otodom directly

        params = {p.get("key"): p for p in it.get("params") or []}

        def pval(key: str, field: str = "key"):
            v = (params.get(key) or {}).get("value") or {}
            return v.get(field) if isinstance(v, dict) else v

        def pnum(key: str) -> float | None:
            v = pval(key)
            try:
                return float(str(v).replace(",", ".")) if v not in (None, "") else None
            except ValueError:
                return None

        price = (params.get("price") or {}).get("value") or {}
        loc_raw = it.get("location") or {}
        mp = it.get("map") or {}
        loc = Location(
            city=(loc_raw.get("city") or {}).get("name"),
            district=(loc_raw.get("district") or {}).get("name"),
            region=(loc_raw.get("region") or {}).get("name"),
            lat=mp.get("lat"), lon=mp.get("lon"),
        )

        raw: list[str] = []
        tags: list[str] = []
        for key, p in params.items():
            vkey = pval(key)
            raw.append(f"{key}={vkey}")
            m = T.OLX_PARAM_MAP.get(key)
            if m:
                tag = m.get(str(vkey)) or m.get(None)
                if tag:
                    tags.append(tag)

        desc = html_to_text(it.get("description"))
        tags += T.tags_from_text(f"{it.get('title', '')}\n{desc}")
        business = bool(it.get("business"))
        tags.append("agency" if business else "private_owner")

        photos = [p["link"].replace("{width}", "655").replace("{height}", "491")
                  for p in it.get("photos") or [] if p.get("link")]
        return Listing(
            source=self.name,
            source_id=str(it["id"]),
            url=it.get("url") or "",
            title=it.get("title") or "",
            price=price.get("value"),
            admin_fee=pnum("rent"),
            currency=price.get("currency") or "PLN",
            area_m2=pnum("m"),
            rooms=ROOMS.get(str(pval("rooms"))),
            floor=pval("floor_select"),
            location=loc,
            author_name=(it.get("user") or {}).get("name"),
            author_type="agency" if business else "private",
            tags=T.normalize(tags),
            raw_tags=raw,
            description=desc,
            image_urls=photos,
            created_at=it.get("created_time"),
        )
