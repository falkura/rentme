"""Otodom.pl adapter.

Otodom is a Next.js site: every page embeds its data as JSON in
<script id="__NEXT_DATA__">. Search pages give a compact list (no description);
the offer page gives the full description, deposit, coordinates, owner and amenities.
"""
from __future__ import annotations

import html
import json
import re
from typing import Iterator
from urllib.parse import urlencode

from ..http import Http
from ..models import Listing, Location, SearchFilters
from .. import tags as T

BASE = "https://www.otodom.pl"

# city -> otodom location path. Find others by searching on otodom and copying
# the part of the URL after /wynajem/mieszkanie/.
CITY_PATHS = {
    "warszawa": "mazowieckie/warszawa/warszawa/warszawa",
    "krakow": "malopolskie/krakow/krakow/krakow",
    "wroclaw": "dolnoslaskie/wroclaw/wroclaw/wroclaw",
    "poznan": "wielkopolskie/poznan/poznan/poznan",
    "gdansk": "pomorskie/gdansk/gdansk/gdansk",
    "gdynia": "pomorskie/gdynia/gdynia/gdynia",
    "lodz": "lodzkie/lodz/lodz/lodz",
    "katowice": "slaskie/katowice/katowice/katowice",
    "lublin": "lubelskie/lublin/lublin/lublin",
    "szczecin": "zachodniopomorskie/szczecin/szczecin/szczecin",
}
ROOMS = {"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5, "SIX": 6,
         "SEVEN": 7, "EIGHT": 8, "NINE": 9, "TEN": 10, "MORE": 10}
ROOMS_REV = {v: k for k, v in ROOMS.items() if k != "MORE"}

_NEXT_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def _next_data(page: str) -> dict:
    m = _NEXT_RE.search(page)
    if not m:
        raise RuntimeError("otodom: __NEXT_DATA__ not found (layout changed?)")
    return json.loads(m.group(1))


def html_to_text(s: str | None) -> str:
    if not s:
        return ""
    s = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</div>|</h\d>", "\n", s)
    s = re.sub(r"(?i)<li[^>]*>", "• ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    s = re.sub(r"[ \t]+", " ", s)
    return re.sub(r"\n\s*\n+", "\n\n", s).strip()


class Otodom:
    name = "otodom"

    def __init__(self, http: Http, location_path: str | None = None):
        self.http = http
        self.location_path = location_path

    # ---------- search ----------
    def search_url(self, f: SearchFilters, page: int) -> str:
        path = self.location_path or CITY_PATHS.get(f.city.lower(), f.city)
        q: dict[str, str] = {"limit": "72", "page": str(page), "by": "LATEST", "direction": "DESC"}
        if f.price_min is not None:
            q["priceMin"] = str(int(f.price_min))
        if f.price_max is not None:
            q["priceMax"] = str(int(f.price_max))
        if f.area_min is not None:
            q["areaMin"] = str(int(f.area_min))
        if f.area_max is not None:
            q["areaMax"] = str(int(f.area_max))
        if f.rooms and 4 not in f.rooms:  # "4+" is filtered locally
            q["roomsNumber"] = "[" + ",".join(ROOMS_REV[r] for r in sorted(f.rooms)) + "]"
        return f"{BASE}/pl/wyniki/wynajem/mieszkanie/{path}?{urlencode(q)}"

    def search(self, f: SearchFilters) -> Iterator[Listing]:
        for page in range(1, f.max_pages + 1):
            data = _next_data(self.http.get(self.search_url(f, page)).text)
            sa = data["props"]["pageProps"]["data"]["searchAds"]
            for it in sa["items"]:
                yield self._from_list_item(it)
            if page >= sa["pagination"]["totalPages"]:
                break

    @staticmethod
    def _location(it: dict) -> Location:
        loc = Location()
        for l in (it.get("location") or {}).get("reverseGeocoding", {}).get("locations", []):
            lvl = l.get("locationLevel")
            if lvl == "city_or_village":
                loc.city = l["name"]
            elif lvl == "district":
                loc.district = l["name"]
            elif lvl == "voivodeship":
                loc.region = l["name"]
        street = (((it.get("location") or {}).get("address") or {}).get("street") or {})
        if street.get("name"):
            loc.street = " ".join(str(x) for x in (street["name"], street.get("number")) if x)
        return loc

    def _from_list_item(self, it: dict) -> Listing:
        loc = self._location(it)

        raw = [t["value"] for t in it.get("tags") or []]
        tags = T.map_codes(raw, T.OTODOM_MAP)
        private = bool(it.get("isPrivateOwner"))
        tags.append("private_owner" if private else "agency")

        price = (it.get("totalPrice") or {}).get("value")
        rent = (it.get("rentPrice") or {}).get("value")
        owner = (it.get("agency") or {}).get("name") or (it.get("advertOwner") or {}).get("name")
        imgs = [i.get("medium") or i.get("large") for i in it.get("images") or []]
        return Listing(
            source=self.name,
            source_id=str(it["id"]),
            url=f"{BASE}/pl/oferta/{it['slug']}",
            title=it.get("title") or "",
            price=price,
            admin_fee=rent,
            currency=(it.get("totalPrice") or {}).get("currency") or "PLN",
            area_m2=it.get("areaInSquareMeters"),
            rooms=ROOMS.get(it.get("roomsNumber") or ""),
            floor=(it.get("floorNumber") or "").lower() or None,
            location=loc,
            author_name=owner,
            author_type="private" if private else ("developer" if it.get("development") else "agency"),
            tags=T.normalize(tags),
            raw_tags=raw,
            image_urls=[u for u in imgs if u],
            created_at=it.get("createdAtFirst") or it.get("dateCreated"),
            extra={"short_description": it.get("shortDescription"), "cross_listed": it.get("isCrossListed")},
        )

    # ---------- details ----------
    def fetch_by_url(self, url: str) -> Listing:
        """A listing that never showed up in a search, built from its own offer page (pasted link)."""
        ad = _next_data(self.http.get(url).text)["props"]["pageProps"].get("ad")
        if not ad:
            raise ValueError("this Otodom page has no offer on it (removed, or not an offer link)")
        private = (ad.get("advertiserType") or "").lower() == "private"
        l = Listing(
            source=self.name, source_id=str(ad["id"]),
            url=ad.get("url") or f"{BASE}/pl/oferta/{ad['slug']}", title=ad.get("title") or "",
            location=self._location(ad),
            author_type="private" if private else "agency",
            tags=["private_owner" if private else "agency"],
            created_at=ad.get("createdAt"),
        )
        return self._apply_ad(l, ad)

    def fetch_details(self, l: Listing) -> Listing:
        return self._apply_ad(l, _next_data(self.http.get(l.url).text)["props"]["pageProps"]["ad"])

    def _apply_ad(self, l: Listing, ad: dict) -> Listing:
        l.description = html_to_text(ad.get("description"))
        chars = {c["key"]: c.get("value") for c in ad.get("characteristics") or []}

        def num(k):
            try:
                return float(chars[k]) if chars.get(k) not in (None, "") else None
            except ValueError:
                return None

        l.price = num("price") or l.price
        if chars.get("rooms_num") and not l.rooms:
            try:
                l.rooms = int(chars["rooms_num"])
            except ValueError:
                pass
        l.admin_fee = num("rent") if num("rent") is not None else l.admin_fee
        l.deposit = num("deposit")
        l.area_m2 = num("m") or l.area_m2
        l.available_from = chars.get("free_from") or None
        if chars.get("floor_no"):
            l.floor = chars["floor_no"]

        coords = (ad.get("location") or {}).get("coordinates") or {}
        l.location.lat, l.location.lon = coords.get("latitude"), coords.get("longitude")

        owner = ad.get("owner") or {}
        contact = ad.get("contactDetails") or {}
        l.author_name = contact.get("name") or owner.get("name") or l.author_name
        adv_type = (ad.get("advertiserType") or contact.get("type") or "").lower()
        if adv_type:
            l.author_type = adv_type if adv_type in ("private", "developer") else "agency"

        # amenities: "extras_types::balcony" -> "balcony"
        raw = list(l.raw_tags)
        for block in (ad.get("additionalInformation") or []) + (ad.get("topInformation") or []):
            for v in block.get("values") or []:
                if "::" in v:
                    raw.append(v.split("::", 1)[1])
        target = ad.get("target") or {}
        for k in ("Extras_types", "Equipment_types", "Security_types", "Media_types"):
            raw += target.get(k) or []
        l.raw_tags = sorted(set(raw))

        tags = list(l.tags) + T.map_codes(l.raw_tags, T.OTODOM_MAP) + T.tags_from_text(f"{l.title}\n{l.description}")
        tags = [t for t in tags if t not in ("private_owner", "agency")]
        tags.append("private_owner" if l.author_type == "private" else "agency")
        l.tags = T.normalize(tags)

        imgs = [i.get("medium") or i.get("large") for i in ad.get("images") or []]
        if imgs:
            l.image_urls = [u for u in imgs if u]
        return l
