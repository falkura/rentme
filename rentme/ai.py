"""AI ranking with Claude.

Listings are sent in small batches (text only, no images) together with your
preferences written in plain language. Claude returns, for each listing, a
0-100 match score, short summary, pros/cons, red flags and facts it extracted
from the description (pets, real monthly cost, availability...).

Results are cached per listing by a hash of (preferences + listing content),
so re-running `update` only pays for new or changed listings.
"""
from __future__ import annotations

import hashlib
import json
from typing import Literal

import anthropic
from pydantic import BaseModel, Field

from .models import Listing
from .tags import TAGS


class ListingEval(BaseModel):
    uid: str
    score: int = Field(description="0-100: how well this listing matches the renter's preferences")
    verdict: Literal["great", "good", "maybe", "poor", "reject"]
    summary: str = Field(description="1-2 sentences in English: what this flat really is")
    pros: list[str]
    cons: list[str]
    red_flags: list[str] = Field(description="Scam signs, hidden costs, contradictions, very short term, etc.")
    pets_allowed: bool | None = None
    estimated_monthly_total_pln: int | None = Field(
        default=None, description="Rent + admin fee + media if stated/estimable, else null")
    available_from: str | None = None
    min_lease_months: int | None = None
    extra_tags: list[str] = Field(description="Tags from the allowed vocabulary that the text supports")


class BatchEval(BaseModel):
    results: list[ListingEval]


SYSTEM_TEMPLATE = """You help a person find an apartment to rent in Poland.
You receive listings scraped from otodom.pl and olx.pl (mostly in Polish).
Read each listing carefully and judge it against the renter's preferences below.

Scoring guide:
- 85-100 "great": matches all hard requirements and most nice-to-haves.
- 70-84 "good": matches hard requirements, some compromises.
- 50-69 "maybe": unclear or notable compromises; worth a look only if little else.
- 20-49 "poor": misses important preferences.
- 0-19 "reject": violates a hard requirement, looks like a scam, or is not actually a flat for rent.

Rules:
- Base facts only on the listing text and fields. If something is not stated, say it is unknown; do not guess it is fine.
- Watch for hidden costs: "czynsz administracyjny", "media", "opłaty licznikowe", agency commission ("prowizja"), high deposit ("kaucja").
- Red flags: payment before viewing, owner abroad, price far below market, copy-paste text, room instead of whole flat.
- extra_tags must only use these values: {tags}
- Return exactly one result per listing, with the same uid.

Renter's preferences:
{preferences}
"""


def listing_prompt(l: Listing) -> str:
    desc = (l.description or "")[:4000]
    fields = {
        "uid": l.uid, "source": l.source, "title": l.title,
        "price_pln": l.price, "admin_fee_pln": l.admin_fee, "deposit_pln": l.deposit,
        "area_m2": l.area_m2, "rooms": l.rooms, "floor": l.floor,
        "location": l.location.label(), "author": l.author_name, "author_type": l.author_type,
        "tags": l.tags, "available_from": l.available_from, "published": l.created_at,
    }
    return json.dumps(fields, ensure_ascii=False) + "\nDESCRIPTION:\n" + desc


class Ranker:
    def __init__(self, preferences: str, model: str = "claude-sonnet-5-5", effort: str = "low", batch_size: int = 6,
                 api_key: str | None = None):
        self.client = anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()
        self.model = model
        self.effort = effort
        self.batch_size = batch_size
        self.system = SYSTEM_TEMPLATE.format(tags=", ".join(TAGS), preferences=preferences.strip())
        self._prefs_hash = hashlib.sha256((self.model + self.system).encode()).hexdigest()[:16]

    def content_hash(self, l: Listing) -> str:
        # tags are excluded: AI itself adds tags, which must not trigger a re-rank
        key = json.dumps([l.title, l.price, l.admin_fee, l.deposit, l.area_m2, l.rooms,
                          l.description, l.available_from], ensure_ascii=False)
        return hashlib.sha256((self._prefs_hash + key).encode()).hexdigest()[:24]

    def evaluate(self, listings: list[Listing]) -> list[ListingEval]:
        out: list[ListingEval] = []
        for i in range(0, len(listings), self.batch_size):
            out += self._batch(listings[i:i + self.batch_size])
        return out

    def _batch(self, batch: list[Listing]) -> list[ListingEval]:
        body = "\n\n=====\n\n".join(listing_prompt(l) for l in batch)
        resp = self.client.messages.parse(
            model=self.model,
            max_tokens=16000,
            # the system prompt (instructions + preferences) is identical for every batch -> cache it
            system=[{"type": "text", "text": self.system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": f"Evaluate these {len(batch)} listings:\n\n{body}"}],
            output_format=BatchEval,
            output_config={"effort": self.effort},
        )
        if resp.stop_reason == "refusal" or resp.parsed_output is None:
            print(f"  ! AI returned no result for batch ({resp.stop_reason}); will retry next run")
            return []
        wanted = {l.uid for l in batch}
        results = [r for r in resp.parsed_output.results if r.uid in wanted]
        for r in results:
            r.score = max(0, min(100, r.score))
            r.extra_tags = [t for t in r.extra_tags if t in TAGS]
        return results
