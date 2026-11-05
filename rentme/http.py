"""Small, polite HTTP client: honest user agent, delay between requests, retries."""
from __future__ import annotations

import random
import time

import httpx

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) rentme-personal-search/0.1"
)


class BlockedError(RuntimeError):
    """The site refused automated access (e.g. 403 from a bot filter)."""


class Http:
    def __init__(self, delay: float = 1.5):
        self.delay = delay
        self._last = 0.0
        self.client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8"},
            follow_redirects=True,
            timeout=30,
        )

    def _wait(self) -> None:
        gap = self.delay + random.uniform(0, self.delay / 2)
        sleep = self._last + gap - time.monotonic()
        if sleep > 0:
            time.sleep(sleep)
        self._last = time.monotonic()

    def get(self, url: str, **kw) -> httpx.Response:
        for attempt in range(3):
            self._wait()
            try:
                r = self.client.get(url, **kw)
            except httpx.TransportError:
                if attempt == 2:
                    raise
                continue
            if r.status_code == 403:
                raise BlockedError(f"403 from {url.split('?')[0]}")
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(5 * (attempt + 1))
                continue
            return r
        return r
