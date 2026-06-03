"""godfat.org ingestion: discover Upcoming banners for a seed, fetch their roll
tables, and turn them into `pathfinder.Banner` objects.

godfat sends `robots: none`, so `GodfatClient` is a deliberately polite client:
descriptive User-Agent, a minimum inter-request interval, exponential backoff on
transient failures, and an on-disk cache keyed by request. Roll tables for a
given seed are immutable, so they cache indefinitely; the per-seed event list
uses a short TTL.

URL scheme (reverse-engineered from the live page — see DECISIONS.md):
  * base list:  https://bc.godfat.org/?seed=SEED
        -> <select name="event"> with <optgroup label="Upcoming:"> options,
           each <option value="YYYY-MM-DD_ID">START ~ END: Description</option>
  * banner:     https://bc.godfat.org/?seed=SEED&event=EVENT_ID&count=N
        -> one roll <table> with pick('NA') cells.
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Optional

import httpx

from . import pathfinder

BASE_URL = "https://bc.godfat.org/"
DEFAULT_COUNT = 100
USER_AGENT = (
    "BattleCatsPathExplorer/0.1 (personal seed-tracking helper; "
    "contact xabier.cendon@gmail.com)"
)

# Banner classification, by substring of the event description.
PLATINUM_MARKER = "100% uber drop rate in the platinum capsules"
LEGEND_MARKER = "guaranteed uber or legend rare from the legend capsules"

_OPTION_RE = re.compile(
    r'<option\s+value="([^"]+)"\s*(selected="selected")?\s*>\s*(.*?)</option>',
    re.DOTALL,
)
_LABEL_RE = re.compile(r"^\s*([\d]{4}-\d{2}-\d{2})\s*~\s*([\d]{4}-\d{2}-\d{2})\s*:\s*(.*)$", re.DOTALL)


@dataclass
class Event:
    event_id: str
    description: str
    date_start: Optional[str] = None
    date_end: Optional[str] = None
    selected: bool = False

    @property
    def banner_type(self) -> str:
        d = self.description.lower()
        if PLATINUM_MARKER in d:
            return pathfinder.BANNER_PLATINUM
        if LEGEND_MARKER in d:
            return pathfinder.BANNER_LEGEND
        return pathfinder.BANNER_NORMAL

    def to_dict(self) -> dict:
        return {
            "event_id": self.event_id,
            "description": self.description,
            "date_start": self.date_start,
            "date_end": self.date_end,
            "banner_type": self.banner_type,
        }


def _slice_upcoming(html_content: str) -> str:
    """Return just the Upcoming optgroup of the event <select>."""
    start = html_content.find('<optgroup label="Upcoming:">')
    if start == -1:
        return ""
    end = html_content.find("</optgroup>", start)
    return html_content[start: end if end != -1 else len(html_content)]


def parse_event_list(html_content: str) -> list[Event]:
    """Parse the Upcoming optgroup into Event objects."""
    section = _slice_upcoming(html_content)
    events: list[Event] = []
    for value, selected, label in _OPTION_RE.findall(section):
        label_text = html.unescape(re.sub(r"\s+", " ", label).strip())
        m = _LABEL_RE.match(label_text)
        if m:
            ds, de, desc = m.group(1), m.group(2), m.group(3).strip()
        else:
            ds, de, desc = None, None, label_text
        events.append(Event(event_id=value, description=desc,
                            date_start=ds, date_end=de, selected=bool(selected)))
    return events


# --------------------------------------------------------------------------- #
# HTTP client with caching + rate limiting
# --------------------------------------------------------------------------- #

class GodfatClient:
    def __init__(
        self,
        cache_dir: Optional[str] = None,
        min_interval: float = 1.5,
        event_list_ttl: float = 1800.0,
        max_retries: int = 4,
        timeout: float = 90.0,
        transport: Optional[httpx.BaseTransport] = None,
        max_memory_entries: int = 24,
        max_memory_bytes: int = 16 * 1024 * 1024,
        banner_ttl: float = 1800.0,
    ):
        # cache_dir=None -> in-memory (RAM) cache only, so the server stores
        # nothing on disk (stateless deploy). A path -> on-disk cache (CLI use).
        #
        # The cache only really helps WITHIN one user's session (the event list
        # is reused by the follow-up search; re-searching a seed avoids re-hitting
        # slow godfat). Across users seeds differ, so there's little cross-user
        # reuse — we therefore keep it small and short-lived: bounded by entry
        # count AND total bytes (godfat pages are ~0.2-0.5 MB each), and even the
        # immutable banner pages expire via banner_ttl so RAM doesn't accumulate.
        self.cache_dir = cache_dir
        self.min_interval = min_interval
        self.event_list_ttl = event_list_ttl
        self.banner_ttl = banner_ttl
        self.max_retries = max_retries
        self.max_memory_entries = max_memory_entries
        self.max_memory_bytes = max_memory_bytes
        self._last_request = 0.0
        self._mem_bytes = 0
        self._mem: "OrderedDict[str, tuple[float, str]]" = OrderedDict()
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)
        self._client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
            timeout=timeout,
            follow_redirects=True,
            transport=transport,
        )

    def close(self):
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # -- cache helpers ----------------------------------------------------- #
    def _cache_path(self, key: str) -> str:
        h = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", key)[:80]
        return os.path.join(self.cache_dir, f"{safe}_{h}.html")

    def _read_cache(self, key: str, ttl: Optional[float]) -> Optional[str]:
        if self.cache_dir is None:
            entry = self._mem.get(key)
            if entry is None:
                return None
            ts, content = entry
            if ttl is not None and (time.time() - ts) > ttl:
                return None
            self._mem.move_to_end(key)  # LRU touch
            return content
        path = self._cache_path(key)
        if not os.path.exists(path):
            return None
        if ttl is not None and (time.time() - os.path.getmtime(path)) > ttl:
            return None
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def _write_cache(self, key: str, content: str) -> None:
        if self.cache_dir is None:
            old = self._mem.pop(key, None)
            if old is not None:
                self._mem_bytes -= len(old[1])
            self._mem[key] = (time.time(), content)
            self._mem_bytes += len(content)
            # Evict oldest until under BOTH the entry-count and byte caps.
            while self._mem and (
                len(self._mem) > self.max_memory_entries
                or self._mem_bytes > self.max_memory_bytes
            ):
                _, (_, evicted) = self._mem.popitem(last=False)
                self._mem_bytes -= len(evicted)
            return
        with open(self._cache_path(key), "w", encoding="utf-8") as f:
            f.write(content)

    # -- fetch with backoff + rate limit ----------------------------------- #
    def _throttle(self):
        elapsed = time.time() - self._last_request
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)

    def _fetch(self, params: dict, cache_key: str, ttl: Optional[float]) -> str:
        cached = self._read_cache(cache_key, ttl)
        if cached is not None:
            return cached
        last_err: Optional[Exception] = None
        for attempt in range(self.max_retries):
            self._throttle()
            try:
                resp = self._client.get(BASE_URL, params=params)
                self._last_request = time.time()
                if resp.status_code == 200:
                    self._write_cache(cache_key, resp.text)
                    return resp.text
                if resp.status_code in (429, 500, 502, 503, 504):
                    last_err = RuntimeError(f"HTTP {resp.status_code}")
                else:
                    resp.raise_for_status()
            except (httpx.HTTPError, RuntimeError) as e:
                last_err = e
            time.sleep(min(2 ** attempt, 30))
        raise RuntimeError(f"godfat fetch failed for {params}: {last_err}")

    # -- public API -------------------------------------------------------- #
    def fetch_event_list(self, seed: str | int) -> list[Event]:
        key = f"events_seed{seed}"
        html_content = self._fetch({"seed": str(seed)}, key, self.event_list_ttl)
        return parse_event_list(html_content)

    def fetch_banner_html(self, seed: str | int, event_id: str, count: int = DEFAULT_COUNT) -> str:
        key = f"banner_seed{seed}_event{event_id}_count{count}"
        # A banner is immutable for a given seed, but we still expire it
        # (banner_ttl) so the RAM cache self-clears between users on disk-less
        # deploys rather than living forever.
        return self._fetch(
            {"seed": str(seed), "event": event_id, "count": str(count)},
            key, ttl=self.banner_ttl,
        )

    def fetch_banner(self, seed: str | int, event: Event, count: int = DEFAULT_COUNT) -> Optional[pathfinder.Banner]:
        html_content = self.fetch_banner_html(seed, event.event_id, count)
        tables = pathfinder.parse_tables(html_content)
        if not tables:
            return None
        # A single-event page yields one roll table; take the first non-empty.
        return pathfinder.Banner(name=event.description, rolls=tables[0], type=event.banner_type)


# --------------------------------------------------------------------------- #
# High-level ingestion
# --------------------------------------------------------------------------- #

@dataclass
class Ingestion:
    seed: str
    banners: list[pathfinder.Banner]
    events: list[Event]
    skipped: list[dict] = field(default_factory=list)  # events with no roll table

    def banner_summaries(self) -> list[dict]:
        out = []
        for i, b in enumerate(self.banners):
            out.append({
                "index": i,
                "name": b.name,
                "type": b.type,
                "positions": len(b.rolls),
            })
        return out


def ingest_upcoming(
    client: GodfatClient,
    seed: str | int,
    count: int = DEFAULT_COUNT,
    include_types: Optional[set[str]] = None,
    resources: Optional[dict] = None,
    event_ids: Optional[set[str]] = None,
) -> Ingestion:
    """Fetch Upcoming banners for a seed and return them as Banners.

    If `event_ids` is given, only those banners are fetched (the recommended
    path — godfat pages are slow, so the UI lets the user pick banners rather
    than fetching all 30+). Special banners (platinum/legend) are excluded
    automatically if the player has 0 of the relevant ticket, when `resources`
    is provided.
    """
    resources = pathfinder.normalize_resources(resources) if resources else None
    events = client.fetch_event_list(seed)
    banners: list[pathfinder.Banner] = []
    skipped: list[dict] = []
    for ev in events:
        if event_ids is not None and ev.event_id not in event_ids:
            continue
        if include_types and ev.banner_type not in include_types:
            continue
        if resources is not None:
            if ev.banner_type == pathfinder.BANNER_PLATINUM and resources["platinum_tickets"] <= 0:
                skipped.append({"event_id": ev.event_id, "reason": "no platinum tickets"})
                continue
            if ev.banner_type == pathfinder.BANNER_LEGEND and resources["legend_tickets"] <= 0:
                skipped.append({"event_id": ev.event_id, "reason": "no legend tickets"})
                continue
        banner = client.fetch_banner(seed, ev, count)
        if banner is None:
            skipped.append({"event_id": ev.event_id, "reason": "no roll table"})
            continue
        banners.append(banner)
    return Ingestion(seed=str(seed), banners=banners, events=events, skipped=skipped)
