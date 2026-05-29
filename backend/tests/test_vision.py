"""Tests for screenshot grid detection + locked/unlocked classification.

Calibrated against the two bundled sample screenshots: one full 6x4 "Rare" page
with locked "?" tiles (different resolution), and one partial "Normal" page of
10 units at a different aspect ratio.
"""

import os

import cv2
import pytest

from app import vision
from app.master import MasterData

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
EX1 = os.path.join(FIXTURES, "example_ingame_catguide.png")          # full page, has "?" locked
EX2 = os.path.join(FIXTURES, "example2_partial.jpeg")                # partial Normal page (10)


@pytest.fixture
def master():
    path = os.path.join(os.path.dirname(__file__), "..", "data", "cat_guide_master.json")
    return MasterData(path)


def test_full_page_detection_and_locked():
    img = cv2.imread(EX1)
    cells, bbox = vision.detect_cells(img)
    # 24-tile page; allow one missed contour (>=23). Slots stay correctly numbered.
    assert len(cells) >= 23
    assert bbox is not None
    locked = {c.slot for c in cells if c.state == vision.LOCKED}
    # The two "?" boxes in this screenshot are at slots 7 and 9.
    assert {7, 9} <= locked
    # Nearly everything else is unlocked.
    assert sum(1 for c in cells if c.state == vision.UNLOCKED) >= 20


def test_partial_page_resolution_independent():
    img = cv2.imread(EX2)
    cells, _ = vision.detect_cells(img)
    # Normal page: exactly 10 units (6 + 4), all unlocked. Different aspect ratio.
    assert len(cells) == 10
    assert [c.slot for c in cells] == list(range(10))
    assert all(c.state == vision.UNLOCKED for c in cells)


def test_detect_screenshot_maps_to_master(master):
    with open(EX2, "rb") as f:
        data = f.read()
    result = vision.detect_screenshot(data, master, page_hint=1)
    assert result["page"] == 1
    assert result["detected_tiles"] == 10
    cells = result["cells"]
    # Slot 0 of page 1 is the very first unit, "Cat".
    slot0 = next(c for c in cells if c["slot"] == 0)
    assert slot0["name"] == "Cat"
    assert slot0["global_index"] == 0
    assert slot0["suggest_owned"] is True   # unlocked -> suggest owned
    # No "too many tiles" note (page 1 has 10 units, we found 10).
    assert all("only has" not in n for n in result["notes"])


def test_detect_screenshot_flags_page_mismatch(master):
    # Feed the full 24-tile page but claim it's page 1 (10 units) -> mismatch note.
    with open(EX1, "rb") as f:
        data = f.read()
    result = vision.detect_screenshot(data, master, page_hint=1)
    assert any("only has" in n for n in result["notes"])
