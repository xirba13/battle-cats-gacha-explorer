"""Tests for godfat ingestion: event-list parsing, banner classification,
caching and rate-limit/backoff — all offline via an httpx MockTransport."""

import os

import httpx
import pytest

from app import pathfinder
from app.godfat import (
    Event,
    GodfatClient,
    ingest_upcoming,
    parse_event_list,
)

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
EVENT_LIST = os.path.join(FIXTURES, "event_list_sample.html")
SAMPLE_BANNERS = os.path.join(FIXTURES, "sample_banners.txt")


@pytest.fixture
def event_html():
    with open(EVENT_LIST, encoding="utf-8") as f:
        return f.read()


@pytest.fixture
def banner_html():
    # A single godfat roll table (the first table of the bundled fixture).
    with open(SAMPLE_BANNERS, encoding="utf-8") as f:
        return f.read().split("<table", 2)[1].join(["<table", ""])


def test_parse_event_list_only_upcoming(event_html):
    events = parse_event_list(event_html)
    # The fixture has a trailing Past optgroup that must be ignored.
    assert len(events) == 30
    assert all(isinstance(e, Event) for e in events)


def test_banner_classification(event_html):
    events = parse_event_list(event_html)
    plat = [e for e in events if e.banner_type == pathfinder.BANNER_PLATINUM]
    leg = [e for e in events if e.banner_type == pathfinder.BANNER_LEGEND]
    assert len(plat) == 1 and "PLATINUM CAPSULES" in plat[0].description
    assert len(leg) == 1 and "Legend Capsules" in leg[0].description


def test_event_label_split(event_html):
    ev = parse_event_list(event_html)[0]
    assert ev.date_start and ev.date_end and ev.description
    assert ev.date_start.count("-") == 2


def _make_client(tmp_path, handler, **kw):
    transport = httpx.MockTransport(handler)
    return GodfatClient(cache_dir=str(tmp_path / "cache"), min_interval=0.0,
                        transport=transport, **kw)


def test_client_caches_banner(tmp_path, event_html, banner_html):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if "event" in request.url.params:
            return httpx.Response(200, text=banner_html)
        return httpx.Response(200, text=event_html)

    client = _make_client(tmp_path, handler)
    h1 = client.fetch_banner_html("123", "2026-05-29_947", count=50)
    h2 = client.fetch_banner_html("123", "2026-05-29_947", count=50)
    assert h1 == h2
    assert calls["n"] == 1  # second call served from cache


def test_client_backoff_then_success(tmp_path, banner_html):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503, text="busy")
        return httpx.Response(200, text=banner_html)

    client = _make_client(tmp_path, handler, max_retries=5)
    html = client.fetch_banner_html("9", "evt", count=10)
    assert "pick(" in html
    assert calls["n"] == 3


def test_ingest_upcoming_builds_typed_banners(tmp_path, event_html, banner_html):
    def handler(request):
        if "event" in request.url.params:
            return httpx.Response(200, text=banner_html)
        return httpx.Response(200, text=event_html)

    client = _make_client(tmp_path, handler)
    # Exclude both special banners by passing 0 special tickets.
    result = ingest_upcoming(client, "123", count=20,
                             resources={"platinum_tickets": 0, "legend_tickets": 0})
    # 30 events, minus the 1 platinum and 1 legend that get skipped.
    assert len(result.banners) == 28
    assert all(b.type == pathfinder.BANNER_NORMAL for b in result.banners)
    assert {s["reason"] for s in result.skipped} == {"no platinum tickets", "no legend tickets"}
    # Each normal banner parsed a roll table.
    assert all(len(b.rolls) > 0 for b in result.banners)


def test_ingest_includes_special_when_tickets_present(tmp_path, event_html, banner_html):
    def handler(request):
        if "event" in request.url.params:
            return httpx.Response(200, text=banner_html)
        return httpx.Response(200, text=event_html)

    client = _make_client(tmp_path, handler)
    result = ingest_upcoming(client, "123", count=20,
                             resources={"platinum_tickets": 5, "legend_tickets": 2})
    types = {b.type for b in result.banners}
    assert pathfinder.BANNER_PLATINUM in types
    assert pathfinder.BANNER_LEGEND in types
