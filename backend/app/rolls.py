"""Rare-gacha roll tables computed locally, instead of scraped from godfat.

A port of the roll logic in godfat's battle-cats-rolls
(https://gitlab.com/godfat/battle-cats-rolls: lib/battle-cats-rolls/gacha.rb,
gacha_pool.rb, cat.rb), Copyright Lin Jen-Shin (godfat), Apache License 2.0
(see LICENSES/battle-cats-rolls-LICENSE.txt). Changes: translated from Ruby to
Python, keeping only what builds a roll table (no pick/highlight, last-cat
input or future ubers), and returning the same per-position dict
`pathfinder.parse_tables` reads from godfat's HTML, so everything downstream
(search, track table, auto seed-fill) works unchanged.

How a table is built (godfat's model):

  * xorshift32 (13, 17, 15). The seed is advanced once before row 1; then each
    row uses the next seeds in order: A's rarity, A's slot (= B's rarity),
    B's slot (= next row A's rarity). So track A row n reads seeds s[2n-1],
    s[2n] and track B reads s[2n], s[2n+1].
  * Rarity: `rarity_seed % 10000` against the event's rare / supa / uber rates
    (legend gets the rest). Cat: `slot_seed % len(slots)` in that rarity's slot
    list, which is the gacha's cat list in order, filtered by rarity.
  * Dupe: a *Rare* cat equal to the cat pulled just before it rerolls: drop its
    slot from a copy of the list, advance the seed, re-pick, and repeat while
    it's still the same cat. Each re-pick is one extra seed step, which moves
    you to the other track (odd) or further down the same one (even).
  * Guaranteed 11-draw: follow the pull chain 10 times from a cell; the 11th
    position's rarity seed picks the uber, and you land one seed step later.
    Computed for every cell and every dupe cell (the "R" rows), as godfat does.
  * The seed after a pull (godfat's link on each cat) is that cat's slot seed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

MASK = 0xFFFFFFFF
BASE = 10000

# Cat rarities as godfat (and the game data) number them.
RARE, SUPA, UBER, LEGEND = 2, 3, 4, 5


def advance(seed: int) -> int:
    """One xorshift32 step."""
    seed ^= (seed << 13) & MASK
    seed ^= seed >> 17
    seed ^= (seed << 15) & MASK
    return seed


def retreat(seed: int) -> int:
    """The inverse of `advance` (godfat's retreat_seed)."""
    seed ^= (seed << 15) & MASK
    seed ^= (seed << 30) & MASK
    seed ^= seed >> 17
    seed ^= (seed << 13) & MASK
    seed ^= (seed << 26) & MASK
    return seed


class Pool:
    """A gacha's slots per rarity plus the event's rates (godfat's GachaPool)."""

    def __init__(self, cat_rarity: dict[int, int], gacha_cats: list[int],
                 rare: int, supa: int, uber: int):
        slots: dict[int, list[int]] = {RARE: [], SUPA: [], UBER: [], LEGEND: []}
        for cid in gacha_cats:
            rarity = cat_rarity.get(cid)
            if rarity is None:
                # godfat: a cat it doesn't know empties the whole pool.
                slots = {RARE: [], SUPA: [], UBER: [], LEGEND: []}
                break
            slots.setdefault(rarity, []).append(cid)
        self.slots = slots
        self.rare, self.supa, self.uber = rare, supa, uber

    def exists(self) -> bool:
        return any(self.slots.values())

    def rarity(self, score: int) -> int:
        if score < self.rare:
            return RARE
        if score < self.rare + self.supa:
            return SUPA
        if score < self.rare + self.supa + self.uber:
            return UBER
        return LEGEND


@dataclass(eq=False)
class _Cat:
    id: int
    rarity: int
    slot_seed: int
    slot: Optional[int]
    sequence: int
    track: int  # 0 = A, 1 = B
    rarity_seed: Optional[int] = None
    steps: Optional[int] = None  # re-picks of a rerolled cat
    next: Optional["_Cat"] = None
    rerolled: Optional["_Cat"] = None
    guaranteed: Optional["_Cat"] = None

    @property
    def pos(self) -> str:
        return f"{self.sequence}{'AB'[self.track]}"


def _new_cat(pool: Pool, rarity: int, slot_seed: int, sequence: int, track: int) -> _Cat:
    slots = pool.slots.get(rarity, [])
    if not slots:
        return _Cat(-1, rarity, slot_seed, None, sequence, track)
    slot = slot_seed % len(slots)
    return _Cat(slots[slot], rarity, slot_seed, slot, sequence, track)


def _reroll(pool: Pool, cat: _Cat) -> _Cat:
    slots = list(pool.slots[cat.rarity])
    next_seed, slot, cid, steps = cat.slot_seed, cat.slot, None, None
    for k in range(1, slots.count(cat.id) + 1):
        next_seed = advance(next_seed)
        del slots[slot]
        if not slots:
            break
        slot = next_seed % len(slots)
        cid = slots[slot]
        if cid != cat.id:
            steps = k
            break
    return _Cat(cid, cat.rarity, next_seed, slot, cat.sequence, cat.track, steps=steps)


def _link(pool: Pool, cat: _Cat, last: Optional[_Cat]) -> None:
    """Point `last.next` at the cat its next pull gives: this cat, or its
    reroll when it dupes `last` (only Rare cats dupe)."""
    if last is not None and cat.rarity == RARE and cat.id == last.id and cat.id > 0:
        if cat.rerolled is None:
            cat.rerolled = _reroll(pool, cat)
        last.next = cat.rerolled
    elif last is not None:
        last.next = cat


def guaranteed_rolls_for(event: dict) -> int:
    """11 for a guaranteed event, 15 for step-up, else 0 (godfat's rule)."""
    if event.get("guaranteed"):
        return 11
    if event.get("step_up"):
        return 15
    return 0


def build_cats(seed: int, pool: Pool, count: int, guaranteed_rolls: int) -> list[list[_Cat]]:
    """godfat's table: `count` rows of [track A cat, track B cat], linked."""
    rows: list[list[_Cat]] = []
    s = advance(seed)
    prev: list[Optional[_Cat]] = [None, None]
    for seq in range(1, count + 1):
        a_seed = s
        s = advance(s)
        b_seed = s
        a = _new_cat(pool, pool.rarity(a_seed % BASE), b_seed, seq, 0)
        a.rarity_seed = a_seed
        s = advance(s)
        b = _new_cat(pool, pool.rarity(b_seed % BASE), s, seq, 1)
        b.rarity_seed = b_seed
        _link(pool, a, prev[0])
        _link(pool, b, prev[1])
        prev = [a, b]
        rows.append([a, b])

    # A reroll lands further down (or on the other track), where it can dupe
    # again. Landings are always later rows, so one pass in order covers them.
    for index, row in enumerate(rows):
        for track, cat in enumerate(row):
            r = cat.rerolled
            if r is None or r.steps is None:
                continue
            ni = index + (track + r.steps) // 2 + 1
            nt = ((track + r.steps - 1) ^ 1) & 1
            if ni < len(rows):
                _link(pool, rows[ni][nt], r)

    if guaranteed_rolls > 0:
        for row in rows:
            for cat in row:
                _fill_guaranteed(pool, rows, guaranteed_rolls, cat)
                if cat.rerolled is not None:
                    _fill_guaranteed(pool, rows, guaranteed_rolls, cat.rerolled)
    return rows


def _fill_guaranteed(pool: Pool, rows: list[list[_Cat]], guaranteed_rolls: int, cat: _Cat) -> None:
    last: Optional[_Cat] = cat
    for _ in range(guaranteed_rolls - 1):
        last = last.next
        if last is None:
            return
    ni = last.sequence - (last.track ^ 1)
    nt = last.track ^ 1
    if not 0 <= ni < len(rows):
        return
    g_seed = rows[last.sequence - 1][last.track].rarity_seed
    g = _new_cat(pool, UBER, g_seed, cat.sequence, cat.track)
    g.next = rows[ni][nt]
    cat.guaranteed = g


def build_rolls(seed: int, pool: Pool, count: int, guaranteed_rolls: int,
                name_of: Callable[[int], str]) -> dict:
    """The roll table in `pathfinder.parse_tables` shape: position ->
    {unit, unit_seed, alt_unit, alt_next, alt_seed, guaranteed_unit,
    guaranteed_next, guaranteed_seed, alt_guaranteed_unit, ...}."""
    def next_pos(c: _Cat) -> Optional[str]:
        return c.next.pos if c.next is not None else None

    out: dict = {}
    for row in build_cats(seed, pool, count, guaranteed_rolls):
        for cat in row:
            entry = {"unit": name_of(cat.id), "unit_seed": str(cat.slot_seed)}
            if cat.rerolled is not None:
                r = cat.rerolled
                entry.update(alt_unit=name_of(r.id), alt_next=next_pos(r), alt_seed=str(r.slot_seed))
                if r.guaranteed is not None:
                    g = r.guaranteed
                    entry.update(alt_guaranteed_unit=name_of(g.id), alt_guaranteed_next=next_pos(g),
                                 alt_guaranteed_seed=str(g.slot_seed))
            if cat.guaranteed is not None:
                g = cat.guaranteed
                entry.update(guaranteed_unit=name_of(g.id), guaranteed_next=next_pos(g),
                             guaranteed_seed=str(g.slot_seed))
            out[cat.pos] = entry
    return out
