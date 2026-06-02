"""Guards on the master list's stable `uid` keys.

The URL owned-code is keyed on `uid` so shared links survive mid-guide
insertions (see DECISIONS.md). These tests lock in the invariants that keep that
true, so a future re-scrape that drifts the uid rule fails loudly instead of
silently corrupting everyone's saved codes.
"""

import json
import os
import re

import pytest

MASTER = os.path.join(os.path.dirname(__file__), "..", "data", "cat_guide_master.json")
EGG_BASE = 100000


@pytest.fixture(scope="module")
def units():
    with open(MASTER, encoding="utf-8") as f:
        return json.load(f)["units"]


def test_every_unit_has_a_uid(units):
    assert all(isinstance(u.get("uid"), int) for u in units)


def test_uids_are_unique(units):
    uids = [u["uid"] for u in units]
    assert len(set(uids)) == len(uids)


def test_non_egg_uid_matches_icon_id(units):
    # Non-egg units derive uid from the UniNNN in their icon filename.
    for u in units:
        if u["uid"] >= EGG_BASE:
            continue
        m = re.search(r"Uni(\d+)", u.get("icon", ""))
        assert m, f"{u['name']} has no UniNNN icon"
        assert u["uid"] == int(m.group(1)), f"{u['name']}: uid {u['uid']} != icon {m.group(1)}"


def test_eggs_use_reserved_block(units):
    # The Ancient Eggs share the Uni000_m00 placeholder, so they get a reserved
    # high-uid block instead of the (colliding) id 0.
    eggs = [u for u in units if u["uid"] >= EGG_BASE]
    assert eggs, "expected an Ancient Egg block"
    assert all("Egg" in u["name"] for u in eggs)
    # None of the real ids reach the reserved block.
    assert max(u["uid"] for u in units if u["uid"] < EGG_BASE) < EGG_BASE
