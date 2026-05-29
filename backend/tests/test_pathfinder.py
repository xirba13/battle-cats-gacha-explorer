"""Tests for the refactored pathfinder library.

Includes the upstream `path_checker` idea as automated assertions: every
solution returned by `find_paths` must re-simulate (`verify_solution`) cleanly
against the parsed banner data.
"""

import os

import pytest

from app import pathfinder as pf

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
SAMPLE = os.path.join(FIXTURES, "sample_banners.txt")


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #

def test_parse_sample_banners():
    banners = pf.parse_data(SAMPLE)
    assert len(banners) == 5
    # First banner, first position, known from the fixture.
    assert banners[0]["1A"]["unit"] == "Vaulter Cat"
    assert banners[0]["1A"]["guaranteed_unit"] == "Mass Production EVA"
    assert banners[0]["1A"]["guaranteed_next"] == "12A"


def test_get_next_pos_normal_advances_track():
    rolls = {"1A": {"unit": "A"}, "2A": {"unit": "B"}}
    unit, nxt, note = pf.get_next_pos_normal("1A", "A", rolls, None)
    assert (unit, nxt, note) == ("A", "2A", "Normal")


def test_get_next_pos_normal_duplicate_switches_track():
    rolls = {"1A": {"unit": "Dup", "alt_unit": "AltUnit", "alt_next": "9B"}}
    # last_unit == normal unit -> duplicate path -> alt unit + alt next.
    unit, nxt, note = pf.get_next_pos_normal("1A", "Dup", rolls, "Dup")
    assert (unit, nxt, note) == ("AltUnit", "9B", "Duplicate")


# --------------------------------------------------------------------------- #
# Pareto domination helpers
# --------------------------------------------------------------------------- #

def test_domination():
    frontier = [(1, 300, 0, 0)]
    assert pf._dominated((2, 300, 0, 0), frontier)        # strictly worse
    assert pf._dominated((1, 300, 0, 0), frontier)        # equal
    assert not pf._dominated((0, 450, 0, 0), frontier)    # cheaper on tickets


def test_insert_frontier_drops_dominated():
    frontier = [(5, 0, 0, 0), (0, 750, 0, 0)]
    out = pf._insert_frontier((3, 0, 0, 0), frontier)
    # (5,0,..) is dominated by (3,0,..) and removed; (0,750,..) kept.
    assert (5, 0, 0, 0) not in out
    assert (0, 750, 0, 0) in out
    assert (3, 0, 0, 0) in out


# --------------------------------------------------------------------------- #
# Synthetic banners — deterministic behaviour
# --------------------------------------------------------------------------- #

def _linear_banner(units, name="B", btype=pf.BANNER_NORMAL, guaranteed=None):
    """Build a banner where pulling at i gives units[i] and advances to i+1."""
    rolls = {}
    for i, u in enumerate(units):
        pos = f"{i + 1}A"
        entry = {"unit": u}
        rolls[pos] = entry
    if guaranteed:
        gpos, gunit, gnext = guaranteed
        rolls.setdefault(gpos, {})["guaranteed_unit"] = gunit
        rolls[gpos]["guaranteed_next"] = gnext
    return pf.Banner(name=name, rolls=rolls, type=btype)


def test_single_pull_cost_model():
    banner = _linear_banner(["A", "Target", "C"])
    sols = pf.find_paths([banner], {"Target"}, resources={"rare_tickets": 10},
                         mode="RESOURCE_LIMIT", max_steps=10000, max_solutions=5)
    assert sols, "should find Target"
    best = sols[0]
    assert best.collected_units == ["Target"]
    # Reach 2A (Target) needs 2 single pulls. Cheapest pays both with rare tickets.
    assert best.cost["rare_tickets"] == 2
    assert best.cost["cat_food"] == 0
    ok, err = pf.verify_solution([banner], best)
    assert ok, err


def test_cat_food_pull_costs_150():
    banner = _linear_banner(["Target"])
    # No rare tickets -> must pay with cat food at 150 each.
    sols = pf.find_paths([banner], {"Target"}, resources={"cat_food": 1000},
                         mode="RESOURCE_LIMIT", max_steps=10000)
    assert sols
    assert sols[0].cost["cat_food"] == pf.CAT_FOOD_PER_PULL
    assert sols[0].cost["rare_tickets"] == 0


def test_11_draw_costs_1500():
    banner = _linear_banner([f"u{i}" for i in range(20)],
                            guaranteed=("1A", "GuaranteedTarget", "12A"))
    sols = pf.find_paths([banner], {"GuaranteedTarget"},
                         resources={"cat_food": 2000, "rare_tickets": 0},
                         mode="RESOURCE_LIMIT", max_steps=10000)
    assert sols
    best = sols[0]
    assert best.actions[0].action_type == pf.ACTION_GUARANTEED_11
    assert best.cost["cat_food"] == pf.CAT_FOOD_PER_11_DRAW
    assert len(best.actions[0].units_pulled) == 11
    ok, err = pf.verify_solution([banner], best)
    assert ok, err


def test_resource_limit_never_exceeded():
    banner = _linear_banner([f"u{i}" for i in range(10)])
    caps = {"rare_tickets": 3, "cat_food": 300}
    sols = pf.find_paths([banner], {f"u{i}" for i in range(10)}, resources=caps,
                         mode="RESOURCE_LIMIT", max_steps=50000, max_solutions=20)
    for s in sols:
        assert s.cost["rare_tickets"] <= caps["rare_tickets"]
        assert s.cost["cat_food"] <= caps["cat_food"]


# --------------------------------------------------------------------------- #
# Platinum / Legend special banners
# --------------------------------------------------------------------------- #

def test_platinum_banner_uses_platinum_tickets_only():
    plat = _linear_banner(["PlatA", "PlatTarget", "PlatC"], name="Platinum",
                          btype=pf.BANNER_PLATINUM)
    sols = pf.find_paths([plat], {"PlatTarget"},
                         resources={"platinum_tickets": 5, "rare_tickets": 99,
                                    "cat_food": 99999},
                         mode="RESOURCE_LIMIT", max_steps=10000)
    assert sols
    best = sols[0]
    assert best.cost["platinum_tickets"] == 2  # two pulls to reach 2A
    assert best.cost["rare_tickets"] == 0
    assert best.cost["cat_food"] == 0
    # No 11-draw action ever generated on a platinum banner.
    assert all(a.action_type == pf.ACTION_PLATINUM for a in best.actions)
    ok, err = pf.verify_solution([plat], best)
    assert ok, err


def test_platinum_banner_excluded_with_zero_tickets():
    plat = _linear_banner(["PlatA", "PlatTarget"], name="Platinum",
                          btype=pf.BANNER_PLATINUM)
    sols = pf.find_paths([plat], {"PlatTarget"},
                         resources={"platinum_tickets": 0, "cat_food": 99999},
                         mode="RESOURCE_LIMIT", max_steps=10000)
    assert sols == []  # banner excluded; target unreachable


def test_legend_banner_uses_legend_tickets_only():
    legend = _linear_banner(["LegA", "LegTarget"], name="Legend",
                            btype=pf.BANNER_LEGEND)
    sols = pf.find_paths([legend], {"LegTarget"},
                         resources={"legend_tickets": 3, "rare_tickets": 99},
                         mode="RESOURCE_LIMIT", max_steps=10000)
    assert sols
    assert sols[0].cost["legend_tickets"] == 2
    assert sols[0].cost["rare_tickets"] == 0
    assert all(a.action_type == pf.ACTION_LEGEND for a in sols[0].actions)


def test_mixed_banners_pick_cheapest_source():
    """A target reachable on both a normal and a legend banner; with a legend
    ticket available the legend pull (1 ticket, position 1A) should win over
    paying rare tickets to walk a normal banner."""
    normal = _linear_banner(["x", "Shared"], name="Normal")
    legend = _linear_banner(["Shared"], name="Legend", btype=pf.BANNER_LEGEND)
    sols = pf.find_paths([normal, legend], {"Shared"},
                         resources={"rare_tickets": 99, "legend_tickets": 1},
                         mode="RESOURCE_LIMIT", max_steps=10000, max_solutions=10)
    assert sols
    # Cheapest collects Shared via a single legend pull.
    best = sols[0]
    assert best.collected_units == ["Shared"]
    for s in sols:
        ok, err = pf.verify_solution([normal, legend], s)
        assert ok, err


# --------------------------------------------------------------------------- #
# End-to-end on the real godfat fixture: every solution must verify
# --------------------------------------------------------------------------- #

def test_real_fixture_solutions_all_verify():
    raw = pf.parse_data(SAMPLE)
    banners = [pf.Banner(name=f"B{i+1}", rolls=r) for i, r in enumerate(raw)]
    targets = {"Mass Production EVA", "The 9th Angel"}
    sols = pf.find_paths(banners, targets,
                         resources={"rare_tickets": 30, "cat_food": 3000},
                         mode="RESOURCE_LIMIT", max_steps=200000, max_solutions=10)
    assert sols, "expected at least one solution on the real fixture"
    for s in sols:
        ok, errors = pf.verify_solution(banners, s)
        assert ok, f"solution failed verification: {errors}"
        # Cost caps respected.
        assert s.cost["rare_tickets"] <= 30
        assert s.cost["cat_food"] <= 3000


def test_strict_mode_finds_complete_solution():
    banner = _linear_banner(["A", "B", "C"])
    sols = pf.find_paths([banner], {"A", "B", "C"}, resources={"rare_tickets": 99},
                         mode="STRICT", max_steps=10000, max_solutions=3)
    assert sols
    for s in sols:
        assert s.collected_count == 3
        ok, err = pf.verify_solution([banner], s)
        assert ok, err
