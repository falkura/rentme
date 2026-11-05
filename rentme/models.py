"""Unified data model shared by all sources (otodom, olx, ...)."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class Location:
    city: str | None = None
    district: str | None = None
    street: str | None = None
    region: str | None = None
    lat: float | None = None
    lon: float | None = None

    def label(self) -> str:
        return ", ".join(p for p in (self.street, self.district, self.city) if p)


@dataclass
class Listing:
    source: str                      # "otodom" | "olx"
    source_id: str                   # id inside the source
    url: str
    title: str
    price: float | None = None       # monthly rent asked by owner (PLN)
    admin_fee: float | None = None   # "czynsz administracyjny" (PLN), if given separately
    deposit: float | None = None
    currency: str = "PLN"
    area_m2: float | None = None
    rooms: int | None = None
    floor: str | None = None
    location: Location = field(default_factory=Location)
    author_name: str | None = None
    author_type: str | None = None   # "private" | "agency" | "developer"
    tags: list[str] = field(default_factory=list)       # unified tags (see tags.py)
    raw_tags: list[str] = field(default_factory=list)   # original platform tags, for debugging
    description: str | None = None   # filled by fetch_details()
    image_urls: list[str] = field(default_factory=list) # URLs only, never downloaded eagerly
    created_at: str | None = None
    available_from: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def uid(self) -> str:
        return f"{self.source}:{self.source_id}"

    @property
    def total_price(self) -> float | None:
        if self.price is None:
            return None
        return self.price + (self.admin_fee or 0)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["uid"] = self.uid
        d["total_price"] = self.total_price
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Listing":
        d = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        d["location"] = Location(**(d.get("location") or {}))
        return cls(**d)


@dataclass
class SearchFilters:
    """Platform-independent search filters. Each source translates these
    to its own URL params; anything a source can't filter server-side is
    applied locally by `matches()`."""
    city: str = "warszawa"
    price_min: float | None = None
    price_max: float | None = None          # applies to total (rent + admin fee) when known
    area_min: float | None = None
    area_max: float | None = None
    rooms: list[int] = field(default_factory=list)   # e.g. [2, 3]; 4 means "4+"
    private_only: bool = False
    required_tags: list[str] = field(default_factory=list)
    excluded_tags: list[str] = field(default_factory=list)
    exclude_keywords: list[str] = field(default_factory=list)  # matched in title/description
    excluded_districts: list[str] = field(default_factory=list)  # e.g. ["Bemowo"]; matched on the district field
    max_pages: int = 3

    def matches(self, l: Listing) -> tuple[bool, str]:
        price = l.total_price
        if self.price_max is not None and price is not None and price > self.price_max:
            return False, f"price {price:.0f} > {self.price_max:.0f}"
        if self.price_min is not None and price is not None and price < self.price_min:
            return False, "price too low"
        if self.area_min is not None and l.area_m2 is not None and l.area_m2 < self.area_min:
            return False, "area too small"
        if self.area_max is not None and l.area_m2 is not None and l.area_m2 > self.area_max:
            return False, "area too big"
        district = (l.location.district or "").strip().lower()
        if district and district in {d.strip().lower() for d in self.excluded_districts}:
            return False, f"district {l.location.district}"
        if self.rooms and l.rooms is not None:
            r = min(l.rooms, 4)
            if r not in self.rooms:
                return False, f"rooms {l.rooms}"
        if self.private_only and l.author_type and l.author_type != "private":
            return False, "not private owner"
        missing = [t for t in self.required_tags if t not in l.tags]
        if missing and l.description is not None:  # only judge once full details are known
            return False, f"missing tags {missing}"
        bad = [t for t in self.excluded_tags if t in l.tags]
        if bad:
            return False, f"excluded tags {bad}"
        text = f"{l.title}\n{l.description or ''}".lower()
        for kw in self.exclude_keywords:
            if kw.lower() in text:
                return False, f"keyword '{kw}'"
        return True, ""
