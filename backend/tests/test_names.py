"""Tests for the godfat<->master name normalisation / alias layer."""

import os

from app.names import NameMatcher, normalize


def test_normalize_basics():
    assert normalize("Li'l Cat") == "lil cat"
    assert normalize("Cat & Dog") == "cat and dog"
    assert normalize("  M. Bison  ") == "m bison"
    assert normalize("Chun-Li") == "chun li"
    assert normalize("D’arc") == normalize("D'arc")


def test_matcher_matches_and_logs(tmp_path):
    units = [
        {"name": "Li'l Cat", "rarity_godfat": "Special"},
        {"name": "Bahamut Cat", "rarity_godfat": "Super Rare"},
    ]
    m = NameMatcher(units)
    assert m.match_name("Li’l Cat") == "Li'l Cat"   # curly apostrophe bridged
    assert m.match_name("bahamut cat") == "Bahamut Cat"
    assert m.match("Nonexistent Uber") is None
    assert "Nonexistent Uber" in m.unmatched

    log = tmp_path / "unmatched.log"
    m.write_unmatched(str(log))
    assert "Nonexistent Uber" in log.read_text(encoding="utf-8")


def test_matcher_against_real_master():
    import json
    path = os.path.join(os.path.dirname(__file__), "..", "data", "cat_guide_master.json")
    units = json.load(open(path, encoding="utf-8"))["units"]
    m = NameMatcher(units)
    # Names that definitely exist in the master list.
    assert m.match_name("Cat") == "Cat"
    assert m.match_name("Bahamut Cat") is not None
