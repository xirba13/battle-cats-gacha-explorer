"""Tests for persistence (db.py) and the service layer (services.py),
including the "I followed this path" workflow."""

import os

import pytest

from app import pathfinder, services
from app.db import Database
from app.master import MasterData


@pytest.fixture
def db(tmp_path):
    d = Database(str(tmp_path / "t.sqlite"))
    yield d
    d.close()


@pytest.fixture
def master():
    path = os.path.join(os.path.dirname(__file__), "..", "data", "cat_guide_master.json")
    return MasterData(path)


def test_settings_roundtrip(db):
    assert db.get_seed() is None
    db.set_seed("12345")
    assert db.get_seed() == "12345"
    merged = db.set_resources({"rare_tickets": 10, "cat_food": 3000})
    assert merged["rare_tickets"] == 10 and merged["platinum_tickets"] == 0
    assert db.get_resources()["cat_food"] == 3000


def test_owned_toggle_and_bulk(db):
    db.set_owned(5, True)
    db.set_owned(7, True)
    assert db.get_owned() == {5, 7}
    db.set_owned(5, False)
    assert db.get_owned() == {7}
    db.set_owned_bulk([1, 2, 3], True)
    assert db.get_owned() == {1, 2, 3, 7}
    db.set_owned_bulk([1, 2], False)
    assert db.get_owned() == {3, 7}


def test_owned_is_per_region(db):
    db.set_region("BCEN (English)")
    db.set_owned(10, True)
    db.set_region("BCJP (Japanese)")
    assert db.get_owned() == set()       # different region, empty
    db.set_owned(20, True)
    db.set_region("BCEN (English)")
    assert db.get_owned() == {10}        # original region preserved


def _linear_banner(units, name="B", btype=pathfinder.BANNER_NORMAL):
    rolls = {f"{i+1}A": {"unit": u} for i, u in enumerate(units)}
    return pathfinder.Banner(name=name, rolls=rolls, type=btype)


def test_compute_targets_excludes_owned(master):
    # Use real master names so matching works.
    banner = _linear_banner(["Cat", "Tank Cat", "Axe Cat"])
    cat_idx = master.index_for_name("Cat")
    report = services.compute_targets([banner], master, owned={cat_idx})
    assert "Cat" not in report.targets
    assert "Tank Cat" in report.targets and "Axe Cat" in report.targets


def test_compute_targets_logs_unmatched(master):
    banner = _linear_banner(["Definitely Not A Real Cat 9000", "Cat"])
    report = services.compute_targets([banner], master, owned=set())
    assert "Definitely Not A Real Cat 9000" in report.unmatched
    # Unmatched still treated as a candidate target.
    assert "Definitely Not A Real Cat 9000" in report.targets


def test_run_search_returns_verified_solutions(master):
    banner = _linear_banner(["Cat", "Tank Cat", "Axe Cat"])
    result = services.run_search([banner], master, owned=set(),
                                 resources={"rare_tickets": 10}, max_solutions=5)
    assert result["solutions"]
    for s in result["solutions"]:
        assert s["verified"] is True
        assert s["verify_errors"] == []


def test_followed_path_marks_owned_and_decrements(db, master):
    db.set_resources({"rare_tickets": 10, "cat_food": 3000})
    db.set_seed("oldseed")
    banner = _linear_banner(["Cat", "Tank Cat"])
    result = services.run_search([banner], master, owned=set(),
                                 resources={"rare_tickets": 10}, max_solutions=1)
    sol = result["solutions"][0]

    applied = services.apply_followed_path(db, master, sol, seed_before="oldseed")

    # Every pulled unit (full draw) is now owned, not just targets.
    pulled_names = [u for a in sol["actions"] for u in a["units_pulled"]]
    for name in pulled_names:
        idx = master.index_for_name(name)
        if idx is not None:
            assert idx in db.get_owned()

    # Resources decremented by cost.
    assert db.get_resources()["rare_tickets"] == 10 - sol["cost"]["rare_tickets"]
    # Old seed cleared; player must re-enter a new one.
    assert db.get_seed() is None
    # History recorded.
    hist = db.get_history()
    assert len(hist) == 1 and hist[0]["seed_before"] == "oldseed"
    assert applied["owned_count"] == len(db.get_owned())


def test_followed_path_counts_only_new_units(db, master):
    # Pre-own "Cat"; the path pulls Cat (already owned) + two targets.
    cat_idx = master.index_for_name("Cat")
    db.set_owned(cat_idx, True)
    db.set_resources({"rare_tickets": 10})
    banner = _linear_banner(["Cat", "Tank Cat", "Axe Cat"])
    result = services.run_search([banner], master, owned={cat_idx},
                                 resources={"rare_tickets": 10}, max_solutions=1)
    sol = result["solutions"][0]

    applied = services.apply_followed_path(db, master, sol, seed_before="s")
    # 3 distinct units pulled (Cat, Tank Cat, Axe Cat) but only 2 are NEW.
    assert applied["units_pulled_count"] == 3
    assert applied["units_added_count"] == 2
    # History records only the newly-owned units.
    assert len(db.get_history()[0]["units_added"]) == 2


def test_api_smoke(tmp_path, monkeypatch):
    """The FastAPI app boots and basic state/owned endpoints work."""
    monkeypatch.setenv("BCPE_DB", str(tmp_path / "api.sqlite"))
    monkeypatch.setenv("BCPE_CACHE", str(tmp_path / "cache"))
    # Import after env is set so the module-level Database uses the temp path.
    import importlib
    from app import main as main_module
    importlib.reload(main_module)
    from fastapi.testclient import TestClient

    client = TestClient(main_module.app)
    assert client.get("/api/health").json() == {"status": "ok"}

    state = client.get("/api/state").json()
    assert "disclaimer" in state and state["owned_count"] == 0

    r = client.post("/api/owned/toggle", json={"global_index": 3, "owned": True})
    assert r.json()["owned_count"] == 1

    m = client.get("/api/master").json()
    assert m["meta"]["total"] == 730
    owned_unit = next(u for u in m["units"] if u["global_index"] == 3)
    assert owned_unit["owned"] is True

    r = client.put("/api/resources", json={"rare_tickets": 5, "cat_food": 1500,
                                           "platinum_tickets": 0, "legend_tickets": 0})
    assert r.json()["resources"]["rare_tickets"] == 5
