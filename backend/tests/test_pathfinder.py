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
    unit, nxt, note, seed = pf.get_next_pos_normal("1A", "A", rolls, None)
    assert (unit, nxt, note) == ("A", "2A", "Normal")


def test_get_next_pos_normal_duplicate_switches_track():
    rolls = {"1A": {"unit": "Dup", "alt_unit": "AltUnit", "alt_next": "9B"}}
    # last_unit == normal unit -> duplicate path -> alt unit + alt next.
    unit, nxt, note, seed = pf.get_next_pos_normal("1A", "Dup", rolls, "Dup")
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


def test_single_pulls_use_tickets_first_then_cat_food():
    # Reaching unit "e" needs 5 single pulls; only 2 rare tickets available.
    banner = _linear_banner(["a", "b", "c", "d", "e"])
    sols = pf.find_paths([banner], {"e"},
                         resources={"rare_tickets": 2, "cat_food": 10000},
                         mode="RESOURCE_LIMIT", max_steps=20000, max_solutions=3)
    assert sols
    best = sols[0]
    # 2 ticket pulls + 3 cat-food pulls (tickets spent first).
    assert best.cost["rare_tickets"] == 2
    assert best.cost["cat_food"] == 3 * pf.CAT_FOOD_PER_PULL
    payments = [a.payment for a in best.actions]
    assert payments == [pf.PAY_RARE_TICKET, pf.PAY_RARE_TICKET,
                        pf.PAY_CAT_FOOD, pf.PAY_CAT_FOOD, pf.PAY_CAT_FOOD]
    ok, err = pf.verify_solution([banner], best)
    assert ok, err


def test_no_cat_food_single_while_tickets_remain():
    banner = _linear_banner(["Target"])
    sols = pf.find_paths([banner], {"Target"},
                         resources={"rare_tickets": 5, "cat_food": 10000},
                         mode="RESOURCE_LIMIT", max_steps=10000)
    assert sols
    # With tickets available, the single pull must be a ticket, never cat food.
    assert sols[0].cost == {"rare_tickets": 1, "cat_food": 0,
                            "platinum_tickets": 0, "legend_tickets": 0}


def test_plain_11_roll_on_non_guaranteed_banner():
    # 15-unit non-guaranteed banner; target is the 11th cat. No rare tickets,
    # so 11 singles would cost 1650 cat food but a single 11-roll costs 1500.
    banner = _linear_banner([f"u{i}" for i in range(15)])
    sols = pf.find_paths([banner], {"u10"},
                         resources={"rare_tickets": 0, "cat_food": 1700},
                         mode="RESOURCE_LIMIT", max_steps=50000, max_solutions=5)
    assert sols
    best = sols[0]
    assert best.actions[0].action_type == pf.ACTION_MULTI_11
    assert len(best.actions[0].units_pulled) == 11
    assert best.cost["cat_food"] == pf.CAT_FOOD_PER_11_DRAW   # 1500, cheaper than 1650
    assert best.cost["rare_tickets"] == 0
    ok, err = pf.verify_solution([banner], best)
    assert ok, err


def test_plain_11_roll_advances_11_positions():
    banner = _linear_banner([f"u{i}" for i in range(20)])
    units, hits, _c, next_pos, _seed, ok = pf._simulate_11_normal("1A", None, banner.rolls, 0, {})
    assert ok and len(units) == 11
    assert units == [f"u{i}" for i in range(11)]
    assert next_pos == "12A"   # 1A + 11 normal pulls


def test_path_trimmed_to_last_target():
    # Two targets but only "Target" is reachable, so the best count is 1 and the
    # search keeps exploring past it — the returned path must still end exactly
    # at the last target, with no trailing waste pulls.
    banner = _linear_banner(["a", "Target", "c", "d", "e", "f", "g"])
    sols = pf.find_paths([banner], {"Target", "NeverInBanner"},
                         resources={"rare_tickets": 10},
                         mode="RESOURCE_LIMIT", max_steps=20000, max_solutions=10)
    assert sols
    best = sols[0]
    assert best.collected_units == ["Target"]
    assert best.actions[-1].targets_hit == ["Target"]   # ends on the target
    assert len(best.actions) == 2                        # pull a, then Target
    assert best.cost["rare_tickets"] == 2                # no trailing pulls counted
    assert best.final_position == "3A"
    for s in sols:
        assert s.actions[-1].targets_hit, "no solution should end on a non-target pull"
        ok, err = pf.verify_solution([banner], s)
        assert ok, err


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


def test_parse_captures_result_seed():
    banners = pf.parse_data(SAMPLE)
    # godfat encodes the seed *after* a pull in the cat's name link.
    assert banners[0]["1A"]["unit_seed"] == "4060011645"
    assert banners[0]["1A"]["guaranteed_seed"] == "2609696845"


def test_solution_carries_final_seed():
    raw = pf.parse_data(SAMPLE)
    banners = [pf.Banner(name=f"B{i+1}", rolls=r) for i, r in enumerate(raw)]
    sols = pf.find_paths(banners, {"Mass Production EVA", "The 9th Angel"},
                         resources={"rare_tickets": 30, "cat_food": 3000},
                         mode="RESOURCE_LIMIT", max_steps=200000, max_solutions=5)
    assert sols
    for s in sols:
        # final_seed equals the last action's result seed and is a real number.
        assert s.final_seed == s.actions[-1].result_seed
        assert s.final_seed and s.final_seed.isdigit()


def test_strict_mode_finds_complete_solution():
    banner = _linear_banner(["A", "B", "C"])
    sols = pf.find_paths([banner], {"A", "B", "C"}, resources={"rare_tickets": 99},
                         mode="STRICT", max_steps=10000, max_solutions=3)
    assert sols
    for s in sols:
        assert s.collected_count == 3
        ok, err = pf.verify_solution([banner], s)
        assert ok, err


# --------------------------------------------------------------------------- #
# Track-table cells
# --------------------------------------------------------------------------- #

def test_solution_cells_match_every_pulled_unit():
    """Each action's cells, read back from the roll table, give exactly the
    units it pulled: 1 cell for a single pull, 11 for an 11-draw (ten normal
    pulls + the guaranteed column of its start row)."""
    raw = pf.parse_data(SAMPLE)
    banners = [pf.Banner(name=f"B{i+1}", rolls=r) for i, r in enumerate(raw)]
    sols = pf.find_paths(banners, {"Mass Production EVA", "The 9th Angel"},
                         resources={"rare_tickets": 30, "cat_food": 3000},
                         mode="RESOURCE_LIMIT", max_steps=200000, max_solutions=10)
    assert sols
    key = {pf.CELL_UNIT: "unit", pf.CELL_ALT: "alt_unit", pf.CELL_GUARANTEED: "guaranteed_unit",
           pf.CELL_ALT_GUARANTEED: "alt_guaranteed_unit"}
    seen = set()
    for s in sols:
        for act, cells in zip(s.actions, pf.solution_cells(banners, s), strict=True):
            rolls = banners[act.banner_index].rolls
            assert [rolls[c["pos"]][key[c["result"]]] for c in cells] == act.units_pulled
            assert cells[0]["pos"] == act.position_from
            expected = {pf.ACTION_GUARANTEED_11: 11, pf.ACTION_MULTI_11: 11}.get(act.action_type, 1)
            assert len(cells) == expected
            seen.add(act.action_type)
            if act.action_type == pf.ACTION_GUARANTEED_11:
                assert cells[-1]["pos"] == act.position_from
                assert cells[-1]["result"] in (pf.CELL_GUARANTEED, pf.CELL_ALT_GUARANTEED)
    assert pf.ACTION_GUARANTEED_11 in seen and pf.ACTION_SINGLE in seen


def test_solution_cells_mark_duplicate_results():
    # 1A gives "Dup" twice in a row on purpose: the second pull at 2A is a dupe
    # and takes the alternate result, jumping to 5B.
    rolls = {"1A": {"unit": "Dup"}, "2A": {"unit": "Dup", "alt_unit": "Alt", "alt_next": "5B"},
             "5B": {"unit": "Target"}}
    banner = pf.Banner(name="B", rolls=rolls)
    sols = pf.find_paths([banner], {"Target"}, resources={"rare_tickets": 5})
    assert sols
    cells = [c for group in pf.solution_cells([banner], sols[0]) for c in group]
    assert cells == [{"pos": "1A", "result": "unit"}, {"pos": "2A", "result": "alt"},
                     {"pos": "5B", "result": "unit"}]


def test_11_draw_after_a_dupe_takes_the_dupe_guaranteed_cell():
    # Pull 1A gives "Dup"; an 11-draw from 2A then starts with a dupe, so
    # godfat's chain runs from 2A's reroll and the uber is 2A's RG cell.
    rolls = {"1A": {"unit": "Dup"},
             "2A": {"unit": "Dup", "alt_unit": "Alt", "alt_next": "3B",
                    "guaranteed_unit": "WrongUber", "guaranteed_next": "13A",
                    "alt_guaranteed_unit": "RightUber", "alt_guaranteed_next": "14B",
                    "alt_guaranteed_seed": "777"}}
    rolls.update({f"{n}{t}": {"unit": f"u{n}{t}"} for n in range(3, 16) for t in "AB"})
    banner = pf.Banner(name="B", rolls=rolls)
    sols = pf.find_paths([banner], {"RightUber", "WrongUber"},
                         resources={"rare_tickets": 1, "cat_food": 1500})
    best = sols[0]
    draw = next(a for a in best.actions if a.action_type == pf.ACTION_GUARANTEED_11)
    assert draw.position_from == "2A" and draw.units_pulled[-1] == "RightUber"
    assert draw.position_to == "14B" and draw.result_seed == "777"
    assert pf.verify_solution([banner], best)[0]
    cells = pf.solution_cells([banner], best)[best.actions.index(draw)]
    assert cells[0] == {"pos": "2A", "result": "alt"}
    assert cells[-1] == {"pos": "2A", "result": "alt_guaranteed"}


def test_guaranteed_banner_offers_no_plain_11_roll():
    # Past the last guaranteed cell (the draw would run off the table), a
    # guaranteed banner can't do a plain 11-roll instead.
    rolls = {f"{i}A": {"unit": f"u{i}"} for i in range(1, 30)}
    rolls["1A"].update(guaranteed_unit="G", guaranteed_next="12A")
    banner = pf.Banner(name="B", rolls=rolls)
    assert banner.has_guaranteed
    sols = pf.find_paths([banner], {"u20"}, resources={"cat_food": 3000})
    assert not any(a.action_type == pf.ACTION_MULTI_11 for s in sols for a in s.actions)
