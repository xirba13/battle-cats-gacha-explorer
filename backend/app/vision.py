"""Screenshot detection for the in-game Cat Guide (Section 1).

Key simplification (per the spec): we do NOT identify which cat is in a cell —
the cell's (page, slot) already determines the unit via the master list. We only
classify each cell as locked ("?" gray box) vs unlocked (real icon), which is a
robust, resolution-independent problem.

Pipeline:
  1. Grid detection — find the dark-bordered light tiles on the teal background
     via saturation masking + contour analysis, with NO hardcoded pixel
     coordinates. Works across phone resolutions / aspect ratios.
  2. Cluster tiles into a 6-column grid (rows inferred — pages may be partial,
     e.g. the Normal page has only 10 units).
  3. Per-cell classification — locked tiles are a near-uniform gray "?" box (low
     interior variance + low edge density); unlocked tiles carry real art.
  4. Map (page, slot) -> master unit so the UI can surface results for the user
     to confirm. Page comes from a hint (user uploads in order); detection never
     overrides the user.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

import cv2
import numpy as np

COLS = 6
MAX_ROWS = 4

LOCKED = "locked"
UNLOCKED = "unlocked"
EMPTY = "empty"  # lattice position with no tile (teal background) — partial page

# Classification thresholds (calibrated on the sample screenshots; see DECISIONS).
# A no-tile position lands on the uniform teal background: high saturation AND
# very low brightness variance. A colourful unlocked icon is also saturated but
# highly varied, so both conditions are required to call a cell empty.
SAT_EMPTY = 90      # interior mean saturation above this ...
STD_EMPTY = 25      # ... AND interior std below this  => background, no tile
STD_LOCKED = 42     # low-saturation cell with std below this => uniform "?" box


@dataclass
class Cell:
    slot: int
    row: int
    col: int
    state: str
    box: tuple[int, int, int, int]  # x, y, w, h
    edge_density: float
    interior_std: float


def _decode(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image.")
    return img


def detect_tiles(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Return tile bounding boxes (x, y, w, h), resolution-independent.

    Tiles are light (white/gray) low-saturation squares; the teal background and
    the wooden frame are highly saturated. We mask low-saturation bright pixels,
    find square-ish contours, and keep the dominant same-size cluster.
    """
    h, w = img.shape[:2]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    S, V = hsv[:, :, 1], hsv[:, :, 2]

    # Tile interiors: low saturation and not dark. Captures white (unlocked) and
    # light-gray (locked) interiors; excludes saturated teal/brown UI.
    mask = ((S < 70) & (V > 110)).astype(np.uint8) * 255
    # Close the dark cat-art / borders so each tile becomes one solid blob.
    k = max(3, int(round(min(h, w) * 0.012)) | 1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = (min(h, w) * 0.04) ** 2  # ignore tiny specks
    boxes = []
    for c in cnts:
        x, y, bw, bh = cv2.boundingRect(c)
        if bh == 0:
            continue
        ar = bw / bh
        if 0.65 < ar < 1.5 and bw * bh > min_area:
            boxes.append((x, y, bw, bh))
    if not boxes:
        return []

    # Keep the dominant tile-size cluster (median side length).
    sides = sorted((bw + bh) / 2 for _, _, bw, bh in boxes)
    med = statistics.median(sides)
    boxes = [b for b in boxes if 0.55 * med < (b[2] + b[3]) / 2 < 1.7 * med]
    return boxes


def _cluster_1d(values: list[float], tol: float) -> list[list[float]]:
    """Cluster sorted scalar values whose gaps are <= tol; return the clusters."""
    if not values:
        return []
    values = sorted(values)
    clusters = [[values[0]]]
    for v in values[1:]:
        if v - clusters[-1][-1] <= tol:
            clusters[-1].append(v)
        else:
            clusters.append([v])
    return clusters


def _largest_grid_component(boxes, side):
    """Keep the largest cluster of boxes connected as a grid.

    Two boxes connect if they are immediate row- or column-neighbours
    (≈ one pitch apart on one axis, aligned on the other). Isolated UI elements
    (Filter/Select buttons, page arrows, the cat-food icon) sit far from the
    grid and fall into smaller components that are discarded.
    """
    n = len(boxes)
    if n <= 1:
        return boxes
    centers = [(x + w / 2, y + h / 2) for x, y, w, h in boxes]
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    near = 1.6 * side
    aligned = 0.55 * side
    for i in range(n):
        for j in range(i + 1, n):
            dx = abs(centers[i][0] - centers[j][0])
            dy = abs(centers[i][1] - centers[j][1])
            same_row = dy < aligned and dx < near
            same_col = dx < aligned and dy < near
            if same_row or same_col:
                parent[find(i)] = find(j)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    best = max(groups.values(), key=len)
    return [boxes[i] for i in best]


def _axis_index(centers: list[float], side: float):
    """Map each centre to a gap-aware lattice index along one axis.

    Returns (assign(center)->index, n_indices). Clustering collapses tiles in
    the same row/column; a missing interior tile leaves a gap that the pitch
    division preserves (so column numbering stays correct)."""
    clusters = _cluster_1d(sorted(centers), side * 0.45)
    means = [sum(c) / len(c) for c in clusters]
    if len(means) > 1:
        diffs = [b - a for a, b in zip(means, means[1:])]
        small = [d for d in diffs if d < 1.7 * side]
        pitch = statistics.median(small) if small else min(diffs)
    else:
        pitch = side * 1.07
    index_of_mean = {m: round((m - means[0]) / pitch) for m in means}

    def assign(value: float) -> int:
        nearest = min(means, key=lambda m: abs(m - value))
        return index_of_mean[nearest]

    return assign, max(index_of_mean.values()) + 1


def classify_region(img: np.ndarray, cx: float, cy: float, s: float):
    """Classify a lattice cell at centre (cx, cy) with tile side s.

    Returns (state, sat_mean, interior_std, edge_density). `state` is one of
    empty (teal background — no tile), locked (uniform gray "?"), unlocked (art).
    Sampling the lattice directly (not a detected contour) means a tile the blob
    detector missed is still classified.
    """
    half = int(s * 0.34)  # interior, away from the dark rounded border
    x0, y0 = int(cx - half), int(cy - half)
    x1, y1 = int(cx + half), int(cy + half)
    h, w = img.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    roi = img[y0:y1, x0:x1]
    if roi.size == 0:
        return EMPTY, 255.0, 0.0, 0.0
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    sat_mean = float(hsv[:, :, 1].mean())
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    interior_std = float(gray.std())
    edges = cv2.Canny(gray, 60, 160)
    edge_density = float((edges > 0).mean())

    if sat_mean > SAT_EMPTY and interior_std < STD_EMPTY:
        return EMPTY, sat_mean, interior_std, edge_density
    state = LOCKED if interior_std < STD_LOCKED else UNLOCKED
    return state, sat_mean, interior_std, edge_density


def detect_cells(img: np.ndarray) -> tuple[list[Cell], tuple | None]:
    """Detect tiles, fit a 6-column lattice, and classify every lattice cell.

    The detected contours only seed the lattice geometry (origin + pitch); the
    grid is then walked exhaustively and each position sampled, so missed tiles
    are recovered and partial pages fall out naturally (empty cells dropped).
    """
    boxes = detect_tiles(img)
    if not boxes:
        return [], None
    side = statistics.median((bw + bh) / 2 for _, _, bw, bh in boxes)
    boxes = _largest_grid_component(boxes, side)

    cxs = [x + bw / 2 for x, _, bw, _ in boxes]
    cys = [y + bh / 2 for _, y, _, bh in boxes]
    col_index, _ = _axis_index(cxs, side)
    row_index, _ = _axis_index(cys, side)

    cells: list[Cell] = []
    for (x, y, bw, bh) in boxes:
        cx, cy = x + bw / 2, y + bh / 2
        col, row = col_index(cx), row_index(cy)
        if col >= COLS or row >= MAX_ROWS:
            continue  # outside a valid Cat Guide page grid
        state, _sat, std, ed = classify_region(img, cx, cy, side)
        if state == EMPTY:
            state = UNLOCKED  # a detected tile is never background
        cells.append(Cell(slot=row * COLS + col, row=row, col=col, state=state,
                          box=(int(x), int(y), int(bw), int(bh)),
                          edge_density=ed, interior_std=std))
    cells.sort(key=lambda c: c.slot)
    if not cells:
        return [], None
    xs = [c.box[0] for c in cells]
    ys = [c.box[1] for c in cells]
    grid_bbox = (min(xs), min(ys),
                 max(c.box[0] + c.box[2] for c in cells) - min(xs),
                 max(c.box[1] + c.box[3] for c in cells) - min(ys))
    return cells, grid_bbox


def detect_screenshot(image_bytes: bytes, master, page_hint: int | None = None) -> dict:
    """Full detection + mapping to master units for one screenshot.

    `page_hint` is the 1-based master page the screenshot shows (the UI uploads
    pages in order). Detection never decides ownership — it produces a
    locked/unlocked suggestion per slot for the user to confirm in Section 2.
    """
    img = _decode(image_bytes)
    cells, grid_bbox = detect_cells(img)
    page = page_hint or 1

    page_units = {u["slot"]: u for u in master.units if u["page"] == page}
    results = []
    for cell in cells:
        unit = page_units.get(cell.slot)
        results.append({
            "slot": cell.slot,
            "row": cell.row,
            "col": cell.col,
            "state": cell.state,
            "suggest_owned": cell.state == UNLOCKED,
            "box": list(cell.box),
            "edge_density": round(cell.edge_density, 4),
            "interior_std": round(cell.interior_std, 2),
            "global_index": unit["global_index"] if unit else None,
            "name": unit["name"] if unit else None,
            "icon": unit.get("icon") if unit else None,
            "icon_url": unit["icon_url"] if unit else None,
            "rarity": unit["rarity_guide"] if unit else None,
        })

    notes = []
    if not cells:
        notes.append("No tiles detected — make sure the Cat Guide fills the frame "
                     "with NO filter applied.")
    page_unit_count = len(page_units)
    if page_unit_count and len(cells) > page_unit_count:
        notes.append(f"Detected {len(cells)} tiles but page {page} only has "
                     f"{page_unit_count} units — check the page number.")

    return {
        "page": page,
        "detected_tiles": len(cells),
        "grid_bbox": list(grid_bbox) if grid_bbox else None,
        "cells": results,
        "notes": notes,
    }
