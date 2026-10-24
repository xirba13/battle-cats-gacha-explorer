"""godfat's game data — banners, gacha pools, cats — kept locally, so the app
builds roll tables itself (`rolls.py`) instead of scraping bc.godfat.org.

Source: `build/bc-en.yaml` in https://gitlab.com/godfat/battle-cats-rolls
(Apache License 2.0; the game data in it is PONOS's). The file is ~2 MB, mostly
unit stats we don't need, and parsing all of it peaks at ~100 MB, too much for
the free-tier server. So we keep only what roll tables need: the current events
(dates, rates, flags), their gachas' cat lists, and those cats' names and
rarities, ~20 KB of JSON:

  * `backend/data/godfat_bcen.json` ships with the app (regenerate it with
    `scrapers/update_godfat_data.py`);
  * the server also refreshes it from GitLab in the background (see main.py),
    extracting the same subset one small YAML block at a time so memory stays
    low. If GitLab can't be reached it just keeps what it has.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import re
import threading
from dataclasses import dataclass
from typing import Optional

import yaml

from . import pathfinder, rolls

log = logging.getLogger(__name__)

SOURCE_URL = "https://gitlab.com/godfat/battle-cats-rolls/-/raw/master/build/bc-en.yaml"
DATA_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "godfat_bcen.json")
# Keep events that ended up to this many days before the data was built, so a
# copy that's a few days old still lists everything running now.
KEEP_DAYS = 7
# godfat's event menu only looks at his 100 most recent events (the last ones
# in the file); older ones with far-off end dates don't show as upcoming there,
# so they don't here either.
EVENTS_SHOWN = 100
USER_AGENT = "BattleCatsGachaExplorer (godfat data refresh; https://github.com/xirba13/battle-cats-gacha-explorer)"

_Loader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
_TOP_KEY = re.compile(r"(?m)^([A-Za-z_]+):[ \t]*$")
_ENTRY = re.compile(r"(?m)^  ([^\s:][^:\n]*):[ \t]*$")
_START_ON = re.compile(r"(?m)^    start_on:\s*'?(\d{4}-\d{2}-\d{2})")
_END_ON = re.compile(r"(?m)^    end_on:\s*'?(\d{4}-\d{2}-\d{2})")
_ID = re.compile(r"(?m)^    id:\s*(\d+)")
_SERIES_ID = re.compile(r"(?m)^    series_id:\s*(-?\d+)")


# --------------------------------------------------------------------------- #
# Extracting the subset from godfat's YAML
# --------------------------------------------------------------------------- #

def _sections(text: str) -> dict[str, str]:
    """Top-level `key:` blocks of the YAML, as text."""
    marks = [(m.group(1), m.start()) for m in _TOP_KEY.finditer(text)]
    out = {}
    for i, (key, start) in enumerate(marks):
        end = marks[i + 1][1] if i + 1 < len(marks) else len(text)
        out[key] = text[start:end]
    return out


def _entries(section: str) -> dict[str, str]:
    """The 2-space-indented entries of a section, as text, by key."""
    marks = [(m.group(1), m.start()) for m in _ENTRY.finditer(section)]
    out = {}
    for i, (key, start) in enumerate(marks):
        end = marks[i + 1][1] if i + 1 < len(marks) else len(section)
        out[key.strip("'\"")] = section[start:end]
    return out


def _load_entry(block: str) -> dict:
    return next(iter(yaml.load(block, Loader=_Loader).values()))


def _iso(value) -> str:
    return value.isoformat() if isinstance(value, (dt.date, dt.datetime)) else str(value)


def _event(key: str, raw: dict) -> dict:
    ev = {
        "start_on": _iso(raw["start_on"]),
        "end_on": _iso(raw["end_on"]),
        "name": str(raw.get("name", "")).strip(),
        "id": int(raw["id"]),
        "rare": int(raw.get("rare", 0)),
        "supa": int(raw.get("supa", 0)),
        "uber": int(raw.get("uber", 0)),
    }
    if raw.get("legend"):
        ev["legend"] = int(raw["legend"])
    for flag in ("guaranteed", "step_up"):
        if raw.get(flag):
            ev[flag] = True
    if raw.get("platinum"):
        ev["platinum"] = str(raw["platinum"])  # "platinum" | "legend" | "dl-100m"
    return ev


def _end_dates(event_blocks: dict[str, str], gacha_blocks: dict[str, str]) -> dict[str, str]:
    """Every event's end date as godfat's site shows it: when an event starts
    before the previous event of the same gacha series has ended, that one ends
    the day it starts (CrystalBall#noramlize_end_date_by_series_id!, run when
    his site loads this file). That's how a Platinum Capsule listed "until
    2030" ends when the next one starts."""
    series = {}
    for key, block in gacha_blocks.items():
        m = _SERIES_ID.search(block)
        if m:
            series[key] = m.group(1)
    ends: dict[str, str] = {}
    latest: dict[Optional[str], str] = {}  # series -> its latest event so far
    for key, block in event_blocks.items():  # file order, like godfat
        start, end, gacha_id = _START_ON.search(block), _END_ON.search(block), _ID.search(block)
        if not (start and end and gacha_id):
            continue
        ends[key] = end.group(1)
        s = series.get(gacha_id.group(1))  # None groups together, like his nil
        earlier = latest.get(s)
        if earlier is not None and start.group(1) < ends[earlier]:
            ends[earlier] = start.group(1)
        latest[s] = key
    return ends


def extract(yaml_text: str, today: Optional[dt.date] = None, keep_days: int = KEEP_DAYS,
            only_events: Optional[set[str]] = None) -> dict:
    """The small dataset from godfat's `bc-en.yaml` text: events that haven't
    ended more than `keep_days` ago (or exactly `only_events`), their gachas,
    and those gachas' cats."""
    today = today or dt.date.today()
    cutoff = (today - dt.timedelta(days=keep_days)).isoformat()
    sections = _sections(yaml_text)
    for needed in ("cats", "gacha", "events"):
        if needed not in sections:
            raise ValueError(f"godfat data has no '{needed}' section")

    event_blocks = _entries(sections["events"])
    gacha_blocks = _entries(sections["gacha"])
    ends = _end_dates(event_blocks, gacha_blocks)
    recent = set(list(event_blocks)[-EVENTS_SHOWN:])
    events: dict[str, dict] = {}
    for key, block in event_blocks.items():
        if only_events is not None:
            if key not in only_events:
                continue
        elif key not in recent or key not in ends or ends[key] < cutoff:
            continue
        events[key] = _event(key, _load_entry(block))
        if key in ends:
            events[key]["end_on"] = ends[key]

    gacha_ids = {str(ev["id"]) for ev in events.values()}
    gacha: dict[str, list[int]] = {}
    for key, block in gacha_blocks.items():
        if key in gacha_ids:
            gacha[key] = [int(c) for c in _load_entry(block).get("cats") or []]

    cat_ids = {str(c) for ids in gacha.values() for c in ids}
    cats: dict[str, list] = {}
    for key, block in _entries(sections["cats"]).items():
        if key in cat_ids:
            raw = _load_entry(block)
            names = raw.get("name") or ["N/A"]
            cats[key] = [str(names[0]), int(raw["rarity"])]

    data = {
        "_meta": {
            "source": SOURCE_URL,
            "license": "battle-cats-rolls is Apache-2.0 (Lin Jen-Shin); game data (c) PONOS",
            "built_on": today.isoformat(),
            "events_from": cutoff if only_events is None else None,
        },
        "cats": dict(sorted(cats.items(), key=lambda kv: int(kv[0]))),
        "gacha": dict(sorted(gacha.items(), key=lambda kv: int(kv[0]))),
        "events": events,  # file order: godfat lists them in this order
    }
    validate(data)
    return data


def validate(data: dict) -> None:
    """Refuse a dataset that couldn't possibly be right (format change, empty
    download...), so a bad refresh never replaces a good one."""
    if not data.get("events"):
        raise ValueError("godfat data: no current events")
    if not data.get("cats"):
        raise ValueError("godfat data: no cats")
    missing = {str(ev["id"]) for ev in data["events"].values()} - set(data.get("gacha", {}))
    if missing and len(missing) == len(data["events"]):
        raise ValueError("godfat data: no event has its gacha")


# --------------------------------------------------------------------------- #
# Using it
# --------------------------------------------------------------------------- #

@dataclass
class LocalEvent:
    event_id: str
    description: str
    date_start: str
    date_end: str
    banner_type: str

    def to_dict(self) -> dict:
        return {
            "event_id": self.event_id,
            "description": self.description,
            "date_start": self.date_start,
            "date_end": self.date_end,
            "banner_type": self.banner_type,
        }


def banner_type(event: dict) -> str:
    """Platinum / Legend Capsules use their own tickets (from godfat's flags:
    uber 100% = platinum; uber + legend 100% for a year or more = legend)."""
    kind = event.get("platinum")
    if kind == "platinum":
        return pathfinder.BANNER_PLATINUM
    if kind == "legend":
        return pathfinder.BANNER_LEGEND
    return pathfinder.BANNER_NORMAL


class Dataset:
    def __init__(self, data: dict):
        self.meta: dict = data.get("_meta", {})
        self.cats: dict[int, tuple[str, int]] = {int(k): (v[0], int(v[1])) for k, v in data["cats"].items()}
        self.gacha: dict[int, list[int]] = {int(k): list(v) for k, v in data["gacha"].items()}
        self.events: dict[str, dict] = dict(data["events"])
        self._rarity = {cid: r for cid, (_n, r) in self.cats.items()}

    def name_of(self, cid: int) -> str:
        return self.cats[cid][0] if cid in self.cats else "N/A"

    def upcoming(self, today: Optional[dt.date] = None) -> list[LocalEvent]:
        """godfat's "Upcoming" list: running now, then starting later."""
        day = (today or dt.date.today()).isoformat()
        ongoing, later = [], []
        for key, ev in self.events.items():
            if day <= ev["start_on"]:
                later.append(key)
            elif day <= ev["end_on"]:
                ongoing.append(key)
        return [self._event(k) for k in ongoing + later]

    def _event(self, key: str) -> LocalEvent:
        ev = self.events[key]
        return LocalEvent(event_id=key, description=ev["name"], date_start=ev["start_on"],
                          date_end=ev["end_on"], banner_type=banner_type(ev))

    def banner(self, seed: int, event_id: str, count: int) -> Optional[pathfinder.Banner]:
        """The event's roll table for `seed`, or None if it has no cats."""
        ev = self.events.get(event_id)
        if ev is None:
            return None
        pool = rolls.Pool(self._rarity, self.gacha.get(ev["id"], []), ev["rare"], ev["supa"], ev["uber"])
        if not pool.exists():
            return None
        # Step-up's 15-draw guarantee isn't modelled by the search (it plans
        # 11-draws), so step-up banners get no guaranteed column for now.
        g_rolls = 11 if ev.get("guaranteed") else 0
        table = rolls.build_rolls(int(seed) & rolls.MASK, pool, count, g_rolls, self.name_of)
        return pathfinder.Banner(name=ev["name"], rolls=table, type=banner_type(ev))


def ingest(dataset: Dataset, seed, count: int, resources: Optional[dict] = None,
           event_ids: Optional[set[str]] = None):
    """Like godfat.ingest_upcoming, but computed locally (same Ingestion)."""
    from .godfat import Ingestion

    seed_text = str(seed).strip()
    if not seed_text.isdigit() or int(seed_text) > rolls.MASK:
        raise ValueError(f"invalid seed {seed!r}: expected a number from 0 to {rolls.MASK}")
    resources = pathfinder.normalize_resources(resources) if resources else None
    events = dataset.upcoming()
    listed = [e.event_id for e in events]
    wanted = set(event_ids) if event_ids is not None else set(listed)
    # The Upcoming list's order (it numbers the banners in the results), then
    # anything else asked for.
    order = [e for e in listed if e in wanted] + sorted(wanted - set(listed))
    banners: list[pathfinder.Banner] = []
    skipped: list[dict] = []
    for event_id in order:
        ev = dataset.events.get(event_id)
        if ev is None:
            skipped.append({"event_id": event_id, "reason": "unknown event"})
            continue
        kind = banner_type(ev)
        if resources is not None:
            if kind == pathfinder.BANNER_PLATINUM and resources["platinum_tickets"] <= 0:
                skipped.append({"event_id": event_id, "reason": "no platinum tickets"})
                continue
            if kind == pathfinder.BANNER_LEGEND and resources["legend_tickets"] <= 0:
                skipped.append({"event_id": event_id, "reason": "no legend tickets"})
                continue
        banner = dataset.banner(int(seed_text), event_id, count)
        if banner is None:
            skipped.append({"event_id": event_id, "reason": "no cats in this gacha"})
            continue
        banners.append(banner)
    return Ingestion(seed=str(seed), banners=banners, events=events, skipped=skipped)


# --------------------------------------------------------------------------- #
# The live copy: shipped file at start, refreshed from GitLab in the background
# --------------------------------------------------------------------------- #

def load_file(path: str = DATA_FILE) -> dict:
    import json

    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dumps(data: dict) -> str:
    """JSON with one entry per line, so data updates diff readably in git."""
    import json

    def one(v):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))

    parts = ["{", f'"_meta":{one(data["_meta"])},']
    for i, section in enumerate(("cats", "gacha", "events")):
        items = list(data[section].items())
        parts.append(f'"{section}":{{')
        parts += [f"{one(k)}:{one(v)}{',' if j < len(items) - 1 else ''}" for j, (k, v) in enumerate(items)]
        parts.append("}" + ("," if i < 2 else ""))
    parts.append("}")
    return "\n".join(parts) + "\n"


class Store:
    """Holds the current Dataset; `refresh()` swaps in a newer one."""

    def __init__(self, data: dict):
        self._dataset = Dataset(data)
        self._etag: Optional[str] = None
        self._lock = threading.Lock()

    @classmethod
    def from_file(cls, path: str = DATA_FILE) -> "Store":
        return cls(load_file(path))

    def current(self) -> Dataset:
        return self._dataset

    def refresh(self, http_get=None) -> bool:
        """Download godfat's YAML and swap the dataset if it changed. Returns
        True when the dataset was replaced. Any failure keeps the current one."""
        import httpx

        get = http_get or (lambda url, headers: httpx.get(url, headers=headers, timeout=60,
                                                          follow_redirects=True))
        headers = {"User-Agent": USER_AGENT}
        if self._etag:
            headers["If-None-Match"] = self._etag
        resp = get(SOURCE_URL, headers)
        if resp.status_code == 304:
            return False
        resp.raise_for_status()
        data = extract(resp.text)
        with self._lock:
            self._dataset = Dataset(data)
            self._etag = resp.headers.get("ETag")
        return True

    def refresh_loop(self, hours: float, stop: threading.Event, first_delay: float = 5.0) -> None:
        wait = first_delay
        while not stop.wait(wait):
            try:
                if self.refresh():
                    log.info("godfat data refreshed: %d events", len(self._dataset.events))
            except Exception as e:  # network, format change: keep what we have
                log.warning("godfat data refresh failed: %s", e)
            wait = hours * 3600
