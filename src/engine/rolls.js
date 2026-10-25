// Rare-gacha roll tables, computed in the browser.
//
// A JavaScript port (by way of this app's old Python server, in git history)
// of the roll logic in godfat's battle-cats-rolls (https://gitlab.com/godfat/battle-cats-rolls:
// lib/battle-cats-rolls/gacha.rb, gacha_pool.rb, cat.rb), Copyright Lin
// Jen-Shin (godfat), Apache License 2.0 (see LICENSES/battle-cats-rolls-LICENSE.txt).
// Changes: translated from Ruby, keeping only what builds a roll table (no
// pick/highlight, last-cat input or future ubers), and returning the
// per-position object the path search reads.
//
// How a table is built (godfat's model):
//   * xorshift32 (13, 17, 15). The seed is advanced once before row 1; then
//     each row uses the next seeds in order: A's rarity, A's slot (= B's
//     rarity), B's slot (= next row A's rarity).
//   * Rarity: `raritySeed % 10000` against the event's rare / supa / uber rates
//     (legend gets the rest). Cat: `slotSeed % slots.length` in that rarity's
//     slot list, which is the gacha's cat list in order, filtered by rarity.
//   * Dupe: a *Rare* cat equal to the cat pulled just before it rerolls: drop
//     its slot from a copy of the list, advance the seed, re-pick, and repeat
//     while it's still the same cat. Each re-pick is one extra seed step.
//   * Guaranteed 11-draw: follow the pull chain 10 times from a cell; the 11th
//     position's rarity seed picks the uber, and you land one seed step later.
//   * The seed after a pull (godfat's link on each cat) is that cat's slot seed.

export const MASK = 0xffffffff;
const BASE = 10000;

// Cat rarities as godfat (and the game data) number them.
export const RARE = 2;
export const SUPA = 3;
export const UBER = 4;
export const LEGEND = 5;

// One xorshift32 step. JS shifts work on 32 bits, so this matches the
// Python's masked version; `>>> 0` keeps the result unsigned.
export function advance(seed) {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 15;
  return seed >>> 0;
}

// The inverse of `advance` (godfat's retreat_seed).
export function retreat(seed) {
  seed ^= seed << 15;
  seed ^= seed << 30;
  seed ^= seed >>> 17;
  seed ^= seed << 13;
  seed ^= seed << 26;
  return seed >>> 0;
}

const emptySlots = () => ({ [RARE]: [], [SUPA]: [], [UBER]: [], [LEGEND]: [] });

// A gacha's slots per rarity plus the event's rates (godfat's GachaPool).
export class Pool {
  constructor(catRarity, gachaCats, rare, supa, uber) {
    let slots = emptySlots();
    for (const cid of gachaCats) {
      const rarity = catRarity.get(cid);
      if (rarity === undefined) {
        // godfat: a cat it doesn't know empties the whole pool.
        slots = emptySlots();
        break;
      }
      (slots[rarity] ??= []).push(cid);
    }
    this.slots = slots;
    this.rare = rare;
    this.supa = supa;
    this.uber = uber;
  }

  exists() {
    return Object.values(this.slots).some((s) => s.length > 0);
  }

  rarity(score) {
    if (score < this.rare) return RARE;
    if (score < this.rare + this.supa) return SUPA;
    if (score < this.rare + this.supa + this.uber) return UBER;
    return LEGEND;
  }
}

class Cat {
  constructor(id, rarity, slotSeed, slot, sequence, track, steps = null) {
    this.id = id;
    this.rarity = rarity;
    this.slotSeed = slotSeed;
    this.slot = slot;
    this.sequence = sequence;
    this.track = track; // 0 = A, 1 = B
    this.raritySeed = null;
    this.steps = steps; // re-picks of a rerolled cat
    this.next = null;
    this.rerolled = null;
    this.guaranteed = null;
  }

  get pos() {
    return `${this.sequence}${this.track ? "B" : "A"}`;
  }
}

function newCat(pool, rarity, slotSeed, sequence, track) {
  const slots = pool.slots[rarity] || [];
  if (!slots.length) return new Cat(-1, rarity, slotSeed, null, sequence, track);
  const slot = slotSeed % slots.length;
  return new Cat(slots[slot], rarity, slotSeed, slot, sequence, track);
}

function reroll(pool, cat) {
  const slots = [...pool.slots[cat.rarity]];
  let nextSeed = cat.slotSeed;
  let slot = cat.slot;
  let cid = null;
  let steps = null;
  const copies = slots.filter((s) => s === cat.id).length;
  for (let k = 1; k <= copies; k++) {
    nextSeed = advance(nextSeed);
    slots.splice(slot, 1);
    if (!slots.length) break;
    slot = nextSeed % slots.length;
    cid = slots[slot];
    if (cid !== cat.id) {
      steps = k;
      break;
    }
  }
  return new Cat(cid, cat.rarity, nextSeed, slot, cat.sequence, cat.track, steps);
}

// Point `last.next` at the cat its next pull gives: this cat, or its reroll
// when it dupes `last` (only Rare cats dupe).
function link(pool, cat, last) {
  if (last !== null && cat.rarity === RARE && cat.id === last.id && cat.id > 0) {
    if (cat.rerolled === null) cat.rerolled = reroll(pool, cat);
    last.next = cat.rerolled;
  } else if (last !== null) {
    last.next = cat;
  }
}

// 11 for a guaranteed event, 15 for step-up, else 0 (godfat's rule).
export function guaranteedRollsFor(event) {
  if (event.guaranteed) return 11;
  if (event.step_up) return 15;
  return 0;
}

// godfat's table: `count` rows of [track A cat, track B cat], linked.
export function buildCats(seed, pool, count, guaranteedRolls) {
  const rows = [];
  let s = advance(seed);
  let prev = [null, null];
  for (let seq = 1; seq <= count; seq++) {
    const aSeed = s;
    s = advance(s);
    const bSeed = s;
    const a = newCat(pool, pool.rarity(aSeed % BASE), bSeed, seq, 0);
    a.raritySeed = aSeed;
    s = advance(s);
    const b = newCat(pool, pool.rarity(bSeed % BASE), s, seq, 1);
    b.raritySeed = bSeed;
    link(pool, a, prev[0]);
    link(pool, b, prev[1]);
    prev = [a, b];
    rows.push([a, b]);
  }

  // A reroll lands further down (or on the other track), where it can dupe
  // again. Landings are always later rows, so one pass in order covers them.
  rows.forEach((row, index) => {
    row.forEach((cat, track) => {
      const r = cat.rerolled;
      if (r === null || r.steps === null) return;
      const ni = index + Math.floor((track + r.steps) / 2) + 1;
      const nt = ((track + r.steps - 1) ^ 1) & 1;
      if (ni < rows.length) link(pool, rows[ni][nt], r);
    });
  });

  if (guaranteedRolls > 0) {
    for (const row of rows) {
      for (const cat of row) {
        fillGuaranteed(pool, rows, guaranteedRolls, cat);
        if (cat.rerolled !== null) fillGuaranteed(pool, rows, guaranteedRolls, cat.rerolled);
      }
    }
  }
  return rows;
}

function fillGuaranteed(pool, rows, guaranteedRolls, cat) {
  let last = cat;
  for (let i = 0; i < guaranteedRolls - 1; i++) {
    last = last.next;
    if (last === null) return;
  }
  const ni = last.sequence - (last.track ^ 1);
  const nt = last.track ^ 1;
  if (!(ni >= 0 && ni < rows.length)) return;
  const gSeed = rows[last.sequence - 1][last.track].raritySeed;
  const g = newCat(pool, UBER, gSeed, cat.sequence, cat.track);
  g.next = rows[ni][nt];
  cat.guaranteed = g;
}

// The roll table, position -> {unit, unit_seed, alt_unit, alt_next, alt_seed,
// guaranteed_unit, guaranteed_next, guaranteed_seed, alt_guaranteed_unit, ...}
// (the keys godfat's scraped tables had, so the search reads either), plus
// what his page doesn't show, for a pull after any cat, from any banner:
//   reroll_unit / _next / _seed: on every Rare cell, what it gives when it
//     dupes your last cat, and where you jump. (godfat's dupe line is the
//     same reroll, shown only where the cell before it on its track, or a
//     reroll landing there, is the same cat.)
//   uber11_unit / _next / _seed: on a guaranteed banner, the uber an 11-draw
//     gets when this cell is its 11th roll (godfat picks it with this cell's
//     rarity seed) and where it lands: the other track, one seed on.
export function buildRolls(seed, pool, count, guaranteedRolls, nameOf) {
  const nextPos = (c) => (c.next !== null ? c.next.pos : null);
  const out = {};
  const rows = buildCats(seed, pool, count, guaranteedRolls);
  const posAt = (index, track) => (index < rows.length ? rows[index][track].pos : null);
  for (const row of rows) {
    for (const cat of row) {
      const entry = { unit: nameOf(cat.id), unit_seed: String(cat.slotSeed) };
      if (cat.rerolled !== null) {
        const r = cat.rerolled;
        entry.alt_unit = nameOf(r.id);
        entry.alt_next = nextPos(r);
        entry.alt_seed = String(r.slotSeed);
        if (r.guaranteed !== null) {
          const g = r.guaranteed;
          entry.alt_guaranteed_unit = nameOf(g.id);
          entry.alt_guaranteed_next = nextPos(g);
          entry.alt_guaranteed_seed = String(g.slotSeed);
        }
      }
      if (cat.guaranteed !== null) {
        const g = cat.guaranteed;
        entry.guaranteed_unit = nameOf(g.id);
        entry.guaranteed_next = nextPos(g);
        entry.guaranteed_seed = String(g.slotSeed);
      }
      if (cat.rarity === RARE && cat.id > 0) {
        // Landing as in buildCats: one row down per two seeds the re-picks
        // took, switching track on an odd number.
        const r = cat.rerolled ?? reroll(pool, cat);
        const index = cat.sequence - 1;
        entry.reroll_unit = nameOf(r.id);
        entry.reroll_next = r.steps === null
          ? null
          : posAt(index + Math.floor((cat.track + r.steps) / 2) + 1, ((cat.track + r.steps - 1) ^ 1) & 1);
        entry.reroll_seed = String(r.slotSeed);
      }
      if (guaranteedRolls === 11) {
        const g = newCat(pool, UBER, cat.raritySeed, cat.sequence, cat.track);
        entry.uber11_unit = nameOf(g.id);
        entry.uber11_next = posAt(cat.sequence - (cat.track ^ 1), cat.track ^ 1);
        entry.uber11_seed = String(g.slotSeed);
      }
      out[cat.pos] = entry;
    }
  }
  return out;
}
