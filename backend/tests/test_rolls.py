"""The local roll engine (rolls.py) against godfat's own tables.

`fixtures/sample_banners.txt` holds five roll tables scraped from bc.godfat.org
for one seed: four guaranteed banners and a Legend Capsule.
`fixtures/godfat_fixture_data.json` is godfat's data for those five events.
Building the tables locally must give every value godfat showed: each cat,
every dupe result and where it jumps, every guaranteed uber (also the ones
after a dupe first pull) and every seed link.
"""

import os

from app import godfat_data, pathfinder, rolls

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
SAMPLE = os.path.join(FIXTURES, "sample_banners.txt")
DATA = os.path.join(FIXTURES, "godfat_fixture_data.json")

# The five tables in the fixture, in order (found by matching every event in
# godfat's data against the fixture's first rows).
FIXTURE_EVENTS = ["2025-12-09_1019", "2025-12-09_1020", "2025-04-28_946",
                  "2025-12-12_1005", "2025-11-07_996"]
# Cats godfat has renamed since the fixture was saved (his page then, his data now).
RENAMED = {"Amakusa Shiro": "Shiro Amakusa", "Terun": "Huntress Terun"}


def test_xorshift_and_its_inverse():
    assert rolls.retreat(rolls.advance(1)) == 1
    s = 139026851
    for _ in range(1000):
        assert rolls.retreat(rolls.advance(s)) == s
        s = rolls.advance(s)
    assert 0 <= s <= rolls.MASK


def test_tables_match_godfat_cell_for_cell():
    godfat_tables = pathfinder.parse_data(SAMPLE)
    dataset = godfat_data.Dataset(godfat_data.load_file(DATA))
    # Each cat's link carries the seed after pulling it; 1A's is two steps in.
    seed = rolls.retreat(rolls.retreat(int(godfat_tables[0]["1A"]["unit_seed"])))
    assert seed == 139026851

    compared = dupes = dupe_guaranteed = guaranteed = 0
    for table, event_id in zip(godfat_tables, FIXTURE_EVENTS, strict=True):
        count = max(int(pos[:-1]) for pos in table)
        ours = dataset.banner(seed, event_id, count).rolls
        assert set(ours) == set(table), event_id
        for pos, cell in table.items():
            mine = {k: RENAMED.get(v, v) for k, v in ours[pos].items()}
            assert mine == cell, f"{event_id} {pos}: {mine} != {cell}"
            compared += len(cell)
            dupes += "alt_unit" in cell
            guaranteed += "guaranteed_unit" in cell
            dupe_guaranteed += "alt_guaranteed_unit" in cell
    # 1,400 cells / 6,268 values, with every kind of cell in them.
    assert compared == 6268
    assert (dupes, dupe_guaranteed, guaranteed) == (20, 20, 1116)


def test_guaranteed_rolls_and_banner_types_follow_godfats_flags():
    assert rolls.guaranteed_rolls_for({"guaranteed": True}) == 11
    assert rolls.guaranteed_rolls_for({"step_up": True}) == 15
    assert rolls.guaranteed_rolls_for({}) == 0
    assert godfat_data.banner_type({"platinum": "platinum"}) == pathfinder.BANNER_PLATINUM
    assert godfat_data.banner_type({"platinum": "legend"}) == pathfinder.BANNER_LEGEND
    assert godfat_data.banner_type({"platinum": "dl-100m"}) == pathfinder.BANNER_NORMAL
    assert godfat_data.banner_type({}) == pathfinder.BANNER_NORMAL


def test_a_missing_cat_empties_the_pool_like_godfat():
    pool = rolls.Pool({1: rolls.RARE, 2: rolls.UBER}, [1, 2, 999], 7000, 2500, 500)
    assert not pool.exists()
    pool = rolls.Pool({1: rolls.RARE, 2: rolls.UBER}, [1, 2], 7000, 2500, 500)
    assert pool.slots[rolls.RARE] == [1] and pool.slots[rolls.UBER] == [2]
