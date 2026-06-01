"""Tests for the stateless service layer and FastAPI surface.

Nothing is persisted: owned/seed/resources go in and come back out. godfat is
mocked so no network is touched.
"""

import importlib
import os

import httpx
import pytest

from app import pathfinder, services
from app.master import MasterData

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


@pytest.fixture
def master():
    path = os.path.join(os.path.dirname(__file__), "..", "data", "cat_guide_master.json")
    return MasterData(path)


def _linear_banner(units, name="B", btype=pathfinder.BANNER_NORMAL):
    rolls = {f"{i+1}A": {"unit": u, "unit_seed": f"seed{i+1}"} for i, u in enumerate(units)}
    return pathfinder.Banner(name=name, rolls=rolls, type=btype)


# --------------------------------------------------------------------------- #
# Service layer (stateless)
# --------------------------------------------------------------------------- #

def test_compute_targets_excludes_owned(master):
    banner = _linear_banner(["Cat", "Tank Cat", "Axe Cat"])
    report = services.compute_targets([banner], master, owned={master.index_for_name("Cat")})
    assert "Cat" not in report.targets
    assert {"Tank Cat", "Axe Cat"} <= set(report.targets)


def test_run_search_returns_verified_solutions_with_seed(master):
    banner = _linear_banner(["Cat", "Tank Cat", "Axe Cat"])
    result = services.run_search([banner], master, owned=set(),
                                 resources={"rare_tickets": 10}, max_solutions=3)
    assert result["solutions"]
    for s in result["solutions"]:
        assert s["verified"] is True
        assert "final_seed" in s


def test_followed_result_is_stateless(master):
    banner = _linear_banner(["Cat", "Tank Cat"])
    sol = services.run_search([banner], master, owned=set(),
                              resources={"rare_tickets": 10}, max_solutions=1)["solutions"][0]
    cat = master.index_for_name("Cat")
    res = services.followed_result(master, sol, owned={cat},
                                   resources={"rare_tickets": 10})
    # Pulled units folded into owned; only NEW ones counted.
    assert cat in res["owned"]
    assert res["units_added_count"] == res["units_pulled_count"] - 1  # Cat already owned
    # New seed comes from the solution; resources decremented by cost.
    assert res["new_seed"] == sol["final_seed"]
    assert res["resources"]["rare_tickets"] == 10 - sol["cost"]["rare_tickets"]


# --------------------------------------------------------------------------- #
# API (stateless, godfat mocked)
# --------------------------------------------------------------------------- #

@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("BCPE_CACHE", raising=False)
    from app import main as main_module
    importlib.reload(main_module)

    def fake_ingest(client, seed, count=100, resources=None, event_ids=None):
        from app import godfat
        rolls = {f"{i+1}A": {"unit": u, "unit_seed": f"s{i+1}"}
                 for i, u in enumerate(["Cat", "Tank Cat", "Axe Cat"])}
        banner = pathfinder.Banner(name="Test", rolls=rolls, type=pathfinder.BANNER_NORMAL)
        return godfat.Ingestion(seed=str(seed), banners=[banner], events=[], skipped=[])

    monkeypatch.setattr(main_module.godfat, "ingest_upcoming", fake_ingest)
    from fastapi.testclient import TestClient
    return TestClient(main_module.app)


def test_health_and_master(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    m = client.get("/api/master").json()
    assert m["meta"]["total"] == 730
    assert "disclaimer" in m
    assert len(m["units"]) == 730


def test_search_then_followed_stateless(client):
    body = {"seed": "111", "event_ids": ["e"], "count": 30,
            "resources": {"rare_tickets": 10, "cat_food": 0,
                          "platinum_tickets": 0, "legend_tickets": 0},
            "owned": []}
    res = client.post("/api/search", json=body).json()
    assert res["solutions"] and all(s["verified"] for s in res["solutions"])
    sol = res["solutions"][0]
    assert sol["final_seed"]

    follow = client.post("/api/followed", json={
        "solution": sol, "owned": [],
        "resources": {"rare_tickets": 10, "cat_food": 0,
                      "platinum_tickets": 0, "legend_tickets": 0},
    }).json()
    assert follow["new_seed"] == sol["final_seed"]
    assert follow["units_added_count"] >= 1
    assert isinstance(follow["owned"], list) and follow["owned"]
    # Server kept no state: a fresh /api/master still reports 0 implicit ownership
    # (owned is client-side; master just lists units).
    assert len(client.get("/api/master").json()["units"]) == 730
