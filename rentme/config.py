"""Settings: config.json (editable from the UI) + secrets.json (API key, never sent back to the browser)."""
from __future__ import annotations

import json
import os
import tomllib
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .models import SearchFilters

DEFAULT_PREFERENCES = """I am looking for a long-term rental (12+ months).
Hard requirements:
- whole apartment, not a room
- separate bedroom
Nice to have:
- close to public transport, balcony, good light, quiet street
- dishwasher, washing machine
Avoid:
- ground floor
"""

DEFAULTS: dict[str, Any] = {
    "search": asdict(SearchFilters(
        price_max=4500, area_min=35, rooms=[2, 3],
        exclude_keywords=["pokój do wynajęcia", "wynajmę pokój", "na doby", "krótkoterminow"],
    )),
    "sources": {"otodom": True, "olx": True, "otodom_location": "", "olx_city_id": 0},
    "scrape": {"db": "rentme.db", "delay": 1.5, "max_details_per_run": 80},
    "ai": {
        "enabled": True, "model": "claude-opus-5-5", "effort": "low", "chat_effort": "medium",
        "batch_size": 6, "max_per_run": 60, "preferences": DEFAULT_PREFERENCES,
        # False: the chat only proposes filter changes (Apply button) unless you explicitly ask it to change them
        "chat_can_edit_filters": False,
        # standing instructions for the AI assistant, editable in the UI or via "remember ..." in chat
        "memory": [
            "Never translate or transliterate proper names: streets, districts, metro stations, "
            "train/tram/bus stops, estates and agencies stay in their original Polish spelling "
            "(e.g. 'ul. Puławska', 'Mokotów', 'metro Wilanowska', 'Warszawa Śródmieście SKM').",
        ],
    },
}

MODELS = [
    {"id": "claude-opus-5-5", "label": "Claude Opus 5.5 (best quality)"},
    {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5 (balanced)"},
    {"id": "claude-haiku-5-5", "label": "Claude Haiku 5.5 (cheapest)"},
]


def _merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


@dataclass
class Config:
    filters: SearchFilters
    sources: dict[str, Any]
    ai: dict[str, Any]
    scrape: dict[str, Any]
    path: Path = field(default=Path("config.json"))

    # ---------- load / save ----------
    @classmethod
    def load(cls, path: str | Path = "config.json") -> "Config":
        path = Path(path)
        raw: dict[str, Any] = {}
        if path.exists():
            text = path.read_text(encoding="utf-8")
            raw = tomllib.loads(text) if path.suffix == ".toml" else json.loads(text)
        elif path.suffix == ".json" and path.with_suffix(".toml").exists():
            raw = tomllib.loads(path.with_suffix(".toml").read_text(encoding="utf-8"))  # migrate old config
        return cls.from_dict(raw, path.with_suffix(".json"))

    @classmethod
    def from_dict(cls, raw: dict[str, Any], path: Path) -> "Config":
        d = _merge(DEFAULTS, raw)
        known = SearchFilters.__dataclass_fields__
        return cls(
            filters=SearchFilters(**{k: v for k, v in d["search"].items() if k in known}),
            sources=d["sources"], ai=d["ai"], scrape=d["scrape"], path=path,
        )

    def to_dict(self) -> dict[str, Any]:
        return {"search": asdict(self.filters), "sources": self.sources, "scrape": self.scrape, "ai": self.ai}

    def save(self) -> None:
        self.path.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")

    @property
    def db_path(self) -> Path:
        return self.path.parent / self.scrape.get("db", "rentme.db")

    # ---------- secrets ----------
    @property
    def secrets_path(self) -> Path:
        return self.path.parent / "secrets.json"

    def _secrets(self) -> dict[str, str]:
        try:
            return json.loads(self.secrets_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def api_key(self) -> str | None:
        return self._secrets().get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY") or None

    def api_key_status(self) -> dict[str, Any]:
        s = self._secrets().get("anthropic_api_key")
        if s:
            return {"set": True, "source": "secrets.json", "hint": f"…{s[-4:]}"}
        if os.environ.get("ANTHROPIC_API_KEY"):
            return {"set": True, "source": "environment variable", "hint": f"…{os.environ['ANTHROPIC_API_KEY'][-4:]}"}
        return {"set": False, "source": None, "hint": None}

    def set_api_key(self, key: str | None) -> None:
        s = self._secrets()
        if key:
            s["anthropic_api_key"] = key.strip()
        else:
            s.pop("anthropic_api_key", None)
        self.secrets_path.write_text(json.dumps(s), encoding="utf-8")

    def access_token(self, new: bool = False) -> str:
        """Key that phones/other devices must present in LAN mode (created once, kept in secrets.json)."""
        import secrets as _secrets
        s = self._secrets()
        if new or not s.get("access_token"):
            s["access_token"] = _secrets.token_urlsafe(9)
            self.secrets_path.write_text(json.dumps(s), encoding="utf-8")
        return s["access_token"]
