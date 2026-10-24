"""godfat_data: extracting the small dataset from godfat's YAML, listing
upcoming banners, building banners, and refreshing without ever losing data."""

import datetime as dt
import json

import pytest

from app import godfat_data, pathfinder

TODAY = dt.date(2026, 10, 23)

# godfat's bc-en.yaml format, cut down to a few entries.
MINI_YAML = """\
cats:
  1:
    name: [Cat, Macho Cat, Mohawk Cat]
    desc: [A cat., A macho cat., A mohawk cat.]
    stat: [{health: 100, knockbacks: 3}]
    rarity: 0
  31:
    name: [Bodhisattva Cat]
    rarity: 3
  38:
    name: [Pogo Cat, Pogo Cat B]
    rarity: 2
  39:
    name: [Wheel Cat]
    rarity: 2
  42:
    name: [Salon Cat]
    rarity: 2
  43:
    name: [Ice Cat, Ice Queen]
    rarity: 4
  50:
    name: [Unused Cat]
    rarity: 2
gacha:
  100:
    cats: [38, 39, 42, 31, 43]
    series_id: 1
    name: Test gacha
    rate: regular
  200:
    cats: [43]
    series_id: 2
    name: Platinum gacha
    rate: platinum
banners:
  1:
    name: Something else
events:
  2026-01-01_100:
    start_on: 2026-01-01
    end_on: 2026-01-05
    version: '150000'
    name: "Long gone"
    id: 100
    rare: 7000
    supa: 2500
    uber: 500
  2026-10-20_100:
    start_on: 2026-10-20
    end_on: 2026-10-25
    version: '150600'
    name: "Running now ★"
    id: 100
    rare: 7000
    supa: 2500
    uber: 500
    guaranteed: true
  2026-10-30_200:
    start_on: 2026-10-30
    end_on: 2030-01-01
    version: '150600'
    name: "Get an Uber Rare Cat!! 100% Uber drop Rate in the PLATINUM CAPSULES!"
    id: 200
    rare: 0
    supa: 0
    uber: 10000
    platinum: platinum
"""


def test_extract_keeps_only_current_events_their_gachas_and_cats():
    data = godfat_data.extract(MINI_YAML, today=TODAY)
    assert list(data["events"]) == ["2026-10-20_100", "2026-10-30_200"]  # 2026-01 ended long ago
    assert data["gacha"] == {"100": [38, 39, 42, 31, 43], "200": [43]}
    # First form names; cats no current gacha has are dropped.
    assert data["cats"] == {"31": ["Bodhisattva Cat", 3], "38": ["Pogo Cat", 2], "39": ["Wheel Cat", 2],
                            "42": ["Salon Cat", 2], "43": ["Ice Cat", 4]}
    ev = data["events"]["2026-10-20_100"]
    assert ev == {"start_on": "2026-10-20", "end_on": "2026-10-25", "name": "Running now ★", "id": 100,
                  "rare": 7000, "supa": 2500, "uber": 500, "guaranteed": True}
    assert data["events"]["2026-10-30_200"]["platinum"] == "platinum"
    # The shipped file's format reads back to the same data.
    assert json.loads(godfat_data.dumps(data)) == data


def test_extract_only_looks_at_godfats_most_recent_events(monkeypatch):
    # godfat's menu considers his last 100 events; with a window of 1 only the
    # newest one can be upcoming, even if older ones haven't ended.
    monkeypatch.setattr(godfat_data, "EVENTS_SHOWN", 1)
    data = godfat_data.extract(MINI_YAML, today=TODAY)
    assert list(data["events"]) == ["2026-10-30_200"]


# Two Platinum Capsules of the same gacha series (godfat's data lists both
# "until 2030") and one of another series.
SERIES_YAML = """\
cats:
  43:
    name: [Ice Cat]
    rarity: 4
gacha:
  200:
    cats: [43]
    series_id: 2
    name: Platinum gacha
    rate: platinum
  201:
    cats: [43]
    series_id: 2
    name: Platinum gacha, newer pool
    rate: platinum
  300:
    cats: [43]
    series_id: 3
    name: Another series
    rate: platinum
events:
  2026-07-11_200:
    start_on: 2026-07-11
    end_on: 2030-01-01
    name: "Old platinum"
    id: 200
    uber: 10000
    platinum: platinum
  2026-10-20_201:
    start_on: 2026-10-20
    end_on: 2030-01-01
    name: "Current platinum"
    id: 201
    uber: 10000
    platinum: platinum
  2026-10-21_300:
    start_on: 2026-10-21
    end_on: 2030-01-01
    name: "Other series"
    id: 300
    uber: 10000
    platinum: platinum
"""


def test_a_newer_event_of_the_same_series_ends_the_older_one():
    # As on godfat's site: the old capsule ends the day the new one starts.
    data = godfat_data.extract(SERIES_YAML, today=TODAY)
    assert {k: ev["end_on"] for k, ev in data["events"].items()} == {
        "2026-07-11_200": "2026-10-20", "2026-10-20_201": "2030-01-01", "2026-10-21_300": "2030-01-01"}
    ds = godfat_data.Dataset(data)
    assert [e.event_id for e in ds.upcoming(today=TODAY)] == ["2026-10-20_201", "2026-10-21_300"]
    assert [e.event_id for e in ds.upcoming(today=dt.date(2026, 10, 20))] == [
        "2026-07-11_200", "2026-10-20_201", "2026-10-21_300"]
    # Ended more than KEEP_DAYS ago: not kept at all.
    assert "2026-07-11_200" not in godfat_data.extract(SERIES_YAML, today=dt.date(2026, 11, 1))["events"]


def test_extract_refuses_data_it_cannot_use():
    with pytest.raises(ValueError):
        godfat_data.extract("not: [godfat, data]\n", today=TODAY)
    with pytest.raises(ValueError):  # nothing current
        godfat_data.extract(MINI_YAML, today=dt.date(2031, 1, 1))


def test_upcoming_is_running_now_then_starting_later():
    ds = godfat_data.Dataset(godfat_data.extract(MINI_YAML, today=TODAY))
    events = ds.upcoming(today=TODAY)
    assert [e.event_id for e in events] == ["2026-10-20_100", "2026-10-30_200"]
    assert [e.banner_type for e in events] == [pathfinder.BANNER_NORMAL, pathfinder.BANNER_PLATINUM]
    assert events[0].to_dict() == {"event_id": "2026-10-20_100", "description": "Running now ★",
                                   "date_start": "2026-10-20", "date_end": "2026-10-25",
                                   "banner_type": pathfinder.BANNER_NORMAL}
    assert [e.event_id for e in ds.upcoming(today=dt.date(2026, 10, 26))] == ["2026-10-30_200"]


def test_banners_are_built_locally_with_guaranteed_cells():
    ds = godfat_data.Dataset(godfat_data.extract(MINI_YAML, today=TODAY))
    banner = ds.banner(12345, "2026-10-20_100", 30)
    assert banner.name == "Running now ★" and banner.type == pathfinder.BANNER_NORMAL
    assert len(banner.rolls) == 60 and banner.has_guaranteed
    assert {e["unit"] for e in banner.rolls.values()} <= {"Pogo Cat", "Wheel Cat", "Salon Cat", "Bodhisattva Cat", "Ice Cat"}
    assert banner.rolls["1A"]["guaranteed_unit"] == "Ice Cat"  # the only uber
    assert ds.banner(12345, "no-such-event", 30) is None


def test_ingest_skips_what_cannot_be_rolled():
    ds = godfat_data.Dataset(godfat_data.extract(MINI_YAML, today=TODAY))
    ing = godfat_data.ingest(ds, "12345", 20, resources={"rare_tickets": 5},
                             event_ids={"2026-10-20_100", "2026-10-30_200", "nope"})
    assert [b.name for b in ing.banners] == ["Running now ★"]
    assert {(s["event_id"], s["reason"]) for s in ing.skipped} == {
        ("2026-10-30_200", "no platinum tickets"), ("nope", "unknown event")}
    with pytest.raises(ValueError):
        godfat_data.ingest(ds, "12a45", 20, event_ids={"2026-10-20_100"})
    with pytest.raises(ValueError):
        godfat_data.ingest(ds, str(2 ** 32), 20, event_ids={"2026-10-20_100"})


class _Resp:
    def __init__(self, status, text="", etag=None):
        self.status_code, self.text, self.headers = status, text, {"ETag": etag} if etag else {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def test_refresh_swaps_data_only_when_new_and_valid(monkeypatch):
    store = godfat_data.Store(godfat_data.extract(MINI_YAML, today=TODAY))
    monkeypatch.setattr(godfat_data.dt, "date", type("D", (dt.date,), {"today": staticmethod(lambda: TODAY)}))
    newer = MINI_YAML.replace('"Running now ★"', '"Renamed banner"')
    seen_headers = []

    def get(answers):
        def _get(url, headers):
            assert url == godfat_data.SOURCE_URL
            seen_headers.append(dict(headers))
            return answers.pop(0)
        return _get

    assert store.refresh(get([_Resp(200, newer, etag="v2")])) is True
    assert store.current().events["2026-10-20_100"]["name"] == "Renamed banner"
    # Same version on GitLab: nothing downloaded, nothing changed.
    assert store.refresh(get([_Resp(304)])) is False
    assert seen_headers[-1].get("If-None-Match") == "v2"
    # A broken download never replaces good data.
    before = store.current()
    with pytest.raises(ValueError):
        store.refresh(get([_Resp(200, "garbage")]))
    with pytest.raises(RuntimeError):
        store.refresh(get([_Resp(503)]))
    assert store.current() is before


def test_shipped_data_loads_and_lists_banners():
    ds = godfat_data.Dataset(godfat_data.load_file())
    assert ds.meta["source"] == godfat_data.SOURCE_URL
    assert ds.events and ds.cats and ds.gacha
    for ev in ds.events.values():
        assert ev["id"] in ds.gacha
