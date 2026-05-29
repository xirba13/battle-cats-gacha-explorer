"""API-level test of the M4 path-finding workflow: /api/search then
/api/followed, with godfat ingestion mocked so no network is touched."""

import importlib

import pytest

from app import pathfinder


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BCPE_DB", str(tmp_path / "api.sqlite"))
    monkeypatch.setenv("BCPE_CACHE", str(tmp_path / "cache"))
    from app import main as main_module
    importlib.reload(main_module)

    # Mock ingestion to return synthetic normal banners (real master names).
    from app import godfat

    def fake_ingest(client, seed, count=100, resources=None, event_ids=None):
        rolls = {f"{i+1}A": {"unit": u} for i, u in enumerate(["Cat", "Tank Cat", "Axe Cat"])}
        banner = pathfinder.Banner(name="Test Banner", rolls=rolls, type=pathfinder.BANNER_NORMAL)
        return godfat.Ingestion(seed=str(seed), banners=[banner], events=[], skipped=[])

    monkeypatch.setattr(main_module.godfat, "ingest_upcoming", fake_ingest)

    from fastapi.testclient import TestClient
    return TestClient(main_module.app)


def test_search_then_follow(client):
    client.put("/api/resources", json={"rare_tickets": 10, "cat_food": 1500,
                                       "platinum_tickets": 0, "legend_tickets": 0})
    client.put("/api/seed", json={"seed": "111"})

    res = client.post("/api/search", json={
        "seed": "111", "event_ids": ["evt"], "count": 30,
    }).json()
    assert res["solutions"], "expected solutions"
    assert all(s["verified"] for s in res["solutions"])
    # Cat is not a target only if owned; here nothing owned -> all 3 are targets.
    assert set(res["targets"]) >= {"Tank Cat", "Axe Cat"}

    sol = res["solutions"][0]
    follow = client.post("/api/followed", json={"solution": sol, "seed_before": "111"}).json()
    assert follow["units_added_count"] >= 1
    assert "NEW seed" in follow["prompt"]

    # Seed cleared; resources decremented; owned count grew.
    state = client.get("/api/state").json()
    assert state["seed"] is None
    assert state["owned_count"] == follow["units_added_count"]
    assert state["resources"]["rare_tickets"] == 10 - sol["cost"]["rare_tickets"]

    # History has one entry.
    hist = client.get("/api/history").json()["history"]
    assert len(hist) == 1 and hist[0]["seed_before"] == "111"
