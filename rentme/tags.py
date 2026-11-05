"""Unified tag vocabulary.

Every source maps its own amenity codes to these tags. On top of that,
`tags_from_text` detects tags from title/description (Polish + English
keywords), because many owners only mention things like pets in free text.
"""
from __future__ import annotations

import re

# Unified tags -> human label
TAGS: dict[str, str] = {
    "balcony": "Balcony / terrace",
    "garden": "Garden",
    "parking": "Parking / garage",
    "elevator": "Elevator",
    "air_conditioning": "Air conditioning",
    "furnished": "Furnished",
    "unfurnished": "Unfurnished",
    "dishwasher": "Dishwasher",
    "washing_machine": "Washing machine",
    "fridge": "Fridge",
    "oven": "Oven",
    "tv": "TV",
    "internet": "Internet",
    "storage": "Storage room / basement",
    "secure_building": "Secure building / monitoring",
    "pets_allowed": "Pets allowed",
    "no_pets": "No pets",
    "students_ok": "Students OK",
    "no_smoking": "Non-smokers only",
    "ground_floor": "Ground floor",
    "new_building": "New building",
    "separate_kitchen": "Separate kitchen",
    "private_owner": "Private owner",
    "agency": "Agency",
    "no_commission": "No agency commission",
    "available_now": "Available now",
}

# Otodom codes (search-list tags, extras_types, equipment_types, security_types, media_types)
OTODOM_MAP: dict[str, str] = {
    "BALCONY": "balcony", "TERRACE": "balcony", "LOGGIA": "balcony",
    "balcony": "balcony", "terrace": "balcony", "loggia": "balcony",
    "GARDEN": "garden", "garden": "garden",
    "PARKING_SPOT": "parking", "GARAGE": "parking", "garage": "parking",
    "LIFT": "elevator", "lift": "elevator",
    "AIR_CONDITIONING": "air_conditioning", "air_conditioning": "air_conditioning",
    "furniture": "furnished", "FURNITURE": "furnished",
    "dishwasher": "dishwasher", "washing_machine": "washing_machine",
    "fridge": "fridge", "oven": "oven", "stove": "oven", "tv": "tv",
    "internet": "internet", "INTERNET": "internet",
    "STORAGE_ROOM": "storage", "usable_room": "storage", "basement": "storage",
    "SECURE_BUILDING": "secure_building", "monitoring": "secure_building",
    "closed_area": "secure_building", "alarm": "secure_building", "entryphone": "secure_building",
    "GROUND_FLOOR": "ground_floor", "ground_floor": "ground_floor",
    "separate_kitchen": "separate_kitchen", "SEPARATE_KITCHEN": "separate_kitchen",
    "PETS_ALLOWED": "pets_allowed",
    "STUDENTS_ALLOWED": "students_ok",
}

# OLX params: key -> {value_key -> tag}. `None` value_key means "any truthy value".
OLX_PARAM_MAP: dict[str, dict[str | None, str]] = {
    "furniture": {"yes": "furnished", "no": "unfurnished"},
    "pets": {"yes": "pets_allowed", "no": "no_pets"},
    "elevator": {"yes": "elevator"},
    "floor_select": {"floor_0": "ground_floor"},
    "builttype": {"blok": None},  # informative only
}

# Free-text detection (lowercased). Order matters for negatives: they win.
_TEXT_RULES: list[tuple[str, str]] = [
    (r"\b(bez zwierz|zwierz\w* (nie|wykluczon)|nie akceptuj\w* zwierz|no pets)", "no_pets"),
    (r"(zwierz\w* (mile widzian|akceptowan|dozwolon|ok)|akceptuj\w* zwierz|pet[ -]?friendly|pets? (allowed|welcome|ok))", "pets_allowed"),
    (r"(dla niepal|niepaląc|non[- ]?smok|zakaz palenia)", "no_smoking"),
    (r"(student\w* (mile|ok|akcept)|dla student)", "students_ok"),
    (r"(balkon|taras|loggi|balcony|terrace)", "balcony"),
    (r"(ogród|ogrodek|ogródek|garden)", "garden"),
    (r"(klimatyzac|air[- ]?condition)", "air_conditioning"),
    (r"(zmywark|dishwasher)", "dishwasher"),
    (r"(pralk|washing machine)", "washing_machine"),
    (r"(miejsce (postojowe|parkingowe)|garaż|garaz|parking)", "parking"),
    (r"(win(da|dą|dy)|elevator|\blift\b)", "elevator"),
    (r"(umeblowan|w pełni wyposażon|furnished)", "furnished"),
    (r"(nieumeblowan|unfurnished)", "unfurnished"),
    (r"(komórk\w* lokator|piwnic|storage room)", "storage"),
    (r"(bez prowizji|0% prowizji|no commission|bezpośrednio od właściciela)", "no_commission"),
    (r"(dostępne od zaraz|od zaraz|available (now|immediately))", "available_now"),
    (r"(oddzielna kuchnia|osobna kuchnia|separate kitchen)", "separate_kitchen"),
    (r"(nowe budownictwo|nowy budynek|new building|apartamentowiec)", "new_building"),
]
_COMPILED = [(re.compile(p, re.I), t) for p, t in _TEXT_RULES]
_CONFLICTS = {"pets_allowed": "no_pets", "furnished": "unfurnished"}


def map_codes(codes: list[str], mapping: dict[str, str]) -> list[str]:
    return [mapping[c] for c in codes if c in mapping]


def tags_from_text(text: str) -> list[str]:
    return [t for rx, t in _COMPILED if rx.search(text or "")]


def normalize(tags: list[str]) -> list[str]:
    """Deduplicate, keep known tags only, resolve contradictions."""
    out = sorted({t for t in tags if t in TAGS})
    # "no_pets" from text beats a generic "pets_allowed" guess, etc.
    for pos, neg in _CONFLICTS.items():
        if pos in out and neg in out:
            out.remove(pos)
    return out
