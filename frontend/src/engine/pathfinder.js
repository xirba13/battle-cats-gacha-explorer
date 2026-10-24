// Battle Cats optimal-pull path search, in the browser. A port of
// backend/app/pathfinder.py (same states, costs, heap order and tie-breaks,
// so it returns the same paths; tests/engine.test.mjs checks that against the
// Python's own results).
//
// A best-first search over states (position, collected targets, last unit,
// per-banner usage) with a min-heap, duplicate-rare track switching, plain and
// guaranteed 11-draws, Platinum/Legend Capsules, and Pareto-optimal domination
// over the 4 resources (rare tickets, cat food, platinum and legend tickets).
// Every returned path is re-simulated by `verifySolution`.

// --------------------------------------------------------------------------- //
// Resource model
// --------------------------------------------------------------------------- //

// Canonical order of the 4 budgets; resource vectors follow it everywhere.
export const RESOURCE_KEYS = ["rare_tickets", "cat_food", "platinum_tickets", "legend_tickets"];

export const CAT_FOOD_PER_PULL = 150; // a single pull paid with cat food
export const CAT_FOOD_PER_11_DRAW = 1500; // an 11-draw, cat food only

export function emptyResources() {
  return { rare_tickets: 0, cat_food: 0, platinum_tickets: 0, legend_tickets: 0 };
}

// Fill in any missing resource keys with 0.
export function normalizeResources(resources) {
  const out = emptyResources();
  for (const [k, v] of Object.entries(resources || {})) {
    if (!RESOURCE_KEYS.includes(k)) throw new Error(`Unknown resource key: ${k}`);
    out[k] = Math.trunc(Number(v)) || 0;
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Banner model
// --------------------------------------------------------------------------- //

export const BANNER_NORMAL = "normal";
export const BANNER_PLATINUM = "platinum";
export const BANNER_LEGEND = "legend";

// A roll table plus its name and type. `rolls` maps "1A", "1B"... to
// {unit, unit_seed, alt_unit, alt_next, alt_seed, guaranteed_unit, ...}.
export class Banner {
  constructor(name, rolls, type = BANNER_NORMAL) {
    this.name = name;
    this.rolls = rolls;
    this.type = type;
    // A guaranteed banner's 11-draw always ends in its guaranteed uber; only
    // banners without guaranteed cells get plain 11-rolls.
    this.hasGuaranteed = Object.values(rolls).some((e) => "guaranteed_unit" in e);
  }

  get isSpecial() {
    return this.type === BANNER_PLATINUM || this.type === BANNER_LEGEND;
  }
}

// [unit, next position, seed] of the guaranteed uber for an 11-draw from this
// cell: godfat's G cell, or its dupe version (RG) when the draw's first pull
// dupes your last cat (the whole chain then starts from the reroll).
export function guaranteedFor(entry, lastUnit) {
  if (lastUnit && entry.unit === lastUnit && "alt_unit" in entry) {
    return [entry.alt_guaranteed_unit ?? null, entry.alt_guaranteed_next ?? null, entry.alt_guaranteed_seed ?? null];
  }
  return [entry.guaranteed_unit ?? null, entry.guaranteed_next ?? null, entry.guaranteed_seed ?? null];
}

// --------------------------------------------------------------------------- //
// Result model (plain objects, the shape the page shows)
// --------------------------------------------------------------------------- //

export const ACTION_SINGLE = "single"; // one pull on a normal banner
export const ACTION_GUARANTEED_11 = "guaranteed_11"; // 11-draw with a guaranteed uber
export const ACTION_MULTI_11 = "multi_11"; // plain 11-roll on a non-guaranteed banner
export const ACTION_PLATINUM = "platinum"; // one Platinum Capsule pull
export const ACTION_LEGEND = "legend"; // one Legend Capsule pull

export const PAY_RARE_TICKET = "rare_ticket";
export const PAY_CAT_FOOD = "cat_food";
export const PAY_PLATINUM_TICKET = "platinum_ticket";
export const PAY_LEGEND_TICKET = "legend_ticket";

const cost = (rt, cf, pt, lt) => Object.freeze({ rare_tickets: rt, cat_food: cf, platinum_tickets: pt, legend_tickets: lt });
const COST_TICKET = cost(1, 0, 0, 0);
const COST_FOOD = cost(0, CAT_FOOD_PER_PULL, 0, 0);
const COST_11 = cost(0, CAT_FOOD_PER_11_DRAW, 0, 0);
const COST_PLATINUM = cost(0, 0, 1, 0);
const COST_LEGEND = cost(0, 0, 0, 1);

function action(bannerIndex, actionType, payment, from, to, units, targetsHit, actionCost, resultSeed) {
  return {
    banner_index: bannerIndex,
    action_type: actionType,
    payment,
    position_from: from,
    position_to: to,
    units_pulled: units,
    targets_hit: targetsHit,
    cost: actionCost,
    result_seed: resultSeed ?? null, // seed after this action
  };
}

// --------------------------------------------------------------------------- //
// One pull on a roll table
// --------------------------------------------------------------------------- //

// Resolve a single pull at `pos`: [unit, next position, note, seed after it].
// If the unit equals the last one pulled and the cell has a dupe line, you get
// that line's unit and jump where it says.
export function getNextPosNormal(pos, _hint, rolls, lastUnit) {
  const entry = rolls[pos];
  if (!entry) return [null, null, null, null];
  const unit = entry.unit ?? null;
  if (lastUnit && unit === lastUnit && "alt_unit" in entry) {
    return [entry.alt_unit, entry.alt_next ?? null, "Duplicate", entry.alt_seed ?? null];
  }
  return [unit, `${parseInt(pos, 10) + 1}${pos[pos.length - 1]}`, "Normal", entry.unit_seed ?? null];
}

// --------------------------------------------------------------------------- //
// Pareto domination over the 4-resource vector
// --------------------------------------------------------------------------- //

// Is resource vector a <= b in every component? (A state's frontier, the
// vectors that reached it with none worse than another on every resource,
// lives in findPaths: how it's stored depends on the budgets.)
const leq = (a, b) => a[0] <= b[0] && a[1] <= b[1] && a[2] <= b[2] && a[3] <= b[3];

// --------------------------------------------------------------------------- //
// Search
// --------------------------------------------------------------------------- //

export const MODE_STRICT = "STRICT";
export const MODE_BEST_EFFORT = "BEST_EFFORT";
export const MODE_RESOURCE_LIMIT = "RESOURCE_LIMIT";

// Rough scalarisation used only for heap ordering (Pareto domination guards
// correctness). Tickets are weighted by their cat-food value.
const WEIGHTS = [CAT_FOOD_PER_PULL, 1, CAT_FOOD_PER_11_DRAW, CAT_FOOD_PER_11_DRAW];
const scalar = (r) => WEIGHTS[0] * r[0] + WEIGHTS[1] * r[1] + WEIGHTS[2] * r[2] + WEIGHTS[3] * r[3];

// Python's heap compares (-collected count, scalar cost, *resources, push
// counter); the counter is unique, so the pop order is fully determined.
function before(a, b) {
  if (a.n !== b.n) return a.n < b.n;
  if (a.s !== b.s) return a.s < b.s;
  for (let i = 0; i < 4; i++) if (a.res[i] !== b.res[i]) return a.res[i] < b.res[i];
  return a.c < b.c;
}

class Heap {
  constructor() {
    this.a = [];
  }

  get size() {
    return this.a.length;
  }

  push(x) {
    const a = this.a;
    let i = a.length;
    a.push(x);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(x, a[p])) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = x;
  }

  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && before(a[r], a[l]) ? r : l;
        if (!before(a[m], last)) break;
        a[i] = a[m];
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

// Count set bits of a target mask (a number, or a BigInt past 31 targets).
function popcount(x) {
  if (typeof x === "bigint") {
    let n = 0;
    for (const ch of x.toString(2)) if (ch === "1") n++;
    return n;
  }
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

const SEP = "\u0001"; // can't appear in a unit name

// Search for resource-efficient pull paths that collect `targets`.
//   resources: budgets (RESOURCE_KEYS; missing = 0). In RESOURCE_LIMIT mode
//     they're hard caps; in STRICT / BEST_EFFORT rare tickets and cat food are
//     unlimited, but Platinum/Legend pulls stay capped by `bannerLimits`.
//   bannerLimits: Map(banner index -> max pulls); special banners default to
//     their ticket count.
//   maxSteps: search-iteration cap. timeLimitMs / maxStates: optional caps on
//     time and on states kept (memory); the Python has neither. `stats.stopped`
//     says which one stopped it early ("steps" / "time" / "states").
//   onProgress({steps, ms}): called now and then while searching.
// Returns the solutions, best first.
//
// Same search as the Python, stored more compactly so big searches fit in a
// phone's memory: a path is a chain of steps that only say "banner b, single
// pull or 11-draw" (the full actions of the few paths that become results are
// rebuilt by replaying them), and only the limited banners' pull counts are
// kept in a state, since nothing reads the others'.
export function findPaths(banners, targets, {
  resources = null,
  bannerLimits = null,
  mode = MODE_RESOURCE_LIMIT,
  maxSteps = 2_000_000,
  maxSolutions = 50,
  startPos = "1A",
  timeLimitMs = null,
  maxStates = null,
  onProgress = null,
  progressEvery = 50_000,
  stats = null,
} = {}) {
  banners = coerceBanners(banners);
  const res0 = normalizeResources(resources);
  const limits = new Map(bannerLimits || []);

  // Auto-cap special banners by their ticket budget and exclude empties.
  banners.forEach((b, idx) => {
    if (b.type === BANNER_PLATINUM && !limits.has(idx)) limits.set(idx, res0.platinum_tickets);
    else if (b.type === BANNER_LEGEND && !limits.has(idx)) limits.set(idx, res0.legend_tickets);
  });
  // Pull counts are kept only for limited banners: slotOf[b] is banner b's
  // place in a state's `usage`, or -1.
  const slotOf = banners.map(() => -1);
  const limitOf = [];
  banners.forEach((_, i) => {
    if (limits.has(i)) {
      slotOf[i] = limitOf.length;
      limitOf.push(limits.get(i));
    }
  });
  const bump = (usage, k) => {
    const u = usage.slice();
    u[k] += 1;
    return u;
  };

  const targetList = [...new Set(targets)].sort();
  const targetToId = new Map(targetList.map((name, i) => [name, i]));
  // Up to 31 targets fit a 32-bit mask; more need a BigInt.
  const big = targetList.length > 31;
  const ZERO = big ? 0n : 0;
  const bits = targetList.map((_, i) => (big ? 1n << BigInt(i) : 2 ** i));
  const allTargets = big ? (1n << BigInt(targetList.length)) - 1n : 2 ** targetList.length - 1;

  const resLimitMode = mode === MODE_RESOURCE_LIMIT;
  const caps = RESOURCE_KEYS.map((k) => res0[k]); // only enforced in RESOURCE_LIMIT mode
  // Single pulls spend rare tickets first; cat food only once tickets run out.
  const rareTicketBudget = res0.rare_tickets;
  const withinCaps = (r) =>
    !resLimitMode || (r[0] <= caps[0] && r[1] <= caps[1] && r[2] <= caps[2] && r[3] <= caps[3]);

  // visited[state key] = Pareto frontier of resource vectors reaching it. The
  // key: position, targets collected, last unit (numbered) and the limited
  // banners' pull counts, joined into one flat string. A state carries its
  // mask as text (`mkey`, base 36 for a BigInt), worked out only when a pull
  // adds a target. (BigInts aren't Map keys: V8 hashes them slowly.)
  const visited = new Map();
  const unitIds = new Map();
  const maskKey = big ? (mask) => mask.toString(36) : (mask) => mask;
  const keyParts = [];
  const visitedKey = (pos, mkey, last, usage) => {
    let unit = unitIds.get(last);
    if (unit === undefined) unitIds.set(last, (unit = unitIds.size));
    keyParts.length = 0;
    keyParts.push(pos, mkey, unit);
    for (let k = 0; k < usage.length; k++) keyParts.push(usage[k]);
    return keyParts.join(SEP);
  };

  // A frontier is one stored vector, or a list of them once there are more
  // (most states only ever get one). A stored vector is packed into a single
  // number when the budgets allow it, which takes far less memory than an
  // array; otherwise it's the array itself.
  const [b1, b2, b3] = [caps[1] + 1, caps[2] + 1, caps[3] + 1];
  const packed = resLimitMode && (caps[0] + 1) * b1 * b2 * b3 <= Number.MAX_SAFE_INTEGER;
  const store = packed ? (r) => ((r[0] * b1 + r[1]) * b2 + r[2]) * b3 + r[3] : (r) => r;
  const scratch = [0, 0, 0, 0];
  const load = packed
    ? (v) => {
      scratch[3] = v % b3;
      v = (v - scratch[3]) / b3;
      scratch[2] = v % b2;
      v = (v - scratch[2]) / b2;
      scratch[1] = v % b1;
      scratch[0] = (v - scratch[1]) / b1;
      return scratch;
    }
    : (v) => v;
  const isList = packed ? (f) => typeof f !== "number" : (f) => typeof f[0] !== "number";
  // True if some vector in `frontier` is <= `r` in every component.
  const dominated = (r, frontier) => {
    if (!isList(frontier)) return leq(load(frontier), r);
    for (const v of frontier) if (leq(load(v), r)) return true;
    return false;
  };
  // Drop any frontier vector dominated by `r`, then add it.
  const insertFrontier = (r, frontier) => {
    const kept = (isList(frontier) ? frontier : [frontier]).filter((v) => !leq(r, load(v)));
    if (!kept.length) return store(r);
    kept.push(store(r));
    return kept;
  };

  const applyUnit = (unit, collected) => {
    const id = targetToId.get(unit);
    if (id !== undefined) {
      const bit = bits[id];
      if ((collected & bit) === ZERO) return [collected | bit, true];
    }
    return [collected, false];
  };

  // A path is its last step: step i came after step stepParent[i] (-1 = the
  // start) and was stepCode[i] = 2 * banner + (11-draw ? 1 : 0).
  let stepParent = new Int32Array(1024);
  let stepCode = new Int32Array(1024);
  let stepCount = 0;
  const addStep = (parent, code) => {
    if (stepCount === stepParent.length) {
      const grow = (a) => {
        const b = new Int32Array(a.length * 2);
        b.set(a);
        return b;
      };
      stepParent = grow(stepParent);
      stepCode = grow(stepCode);
    }
    stepParent[stepCount] = parent;
    stepCode[stepCount] = code;
    return stepCount++;
  };

  const pq = new Heap();
  let counter = 0;
  // A queued state; `n` is minus the number of targets collected.
  const push = (pos, collected, mkey, count, last, usage, res, node) => {
    pq.push({ n: -count, s: scalar(res), res, c: counter++, pos, collected, mkey, last, usage, node });
  };
  // Python's _try_push: skip a state reached at least as cheaply before.
  const admit = (pos, mkey, last, usage, res) => {
    const key = visitedKey(pos, mkey, last, usage);
    const frontier = visited.get(key);
    if (frontier === undefined) {
      visited.set(key, store(res));
      return true;
    }
    if (dominated(res, frontier)) return false;
    visited.set(key, insertFrontier(res, frontier));
    return true;
  };

  const startRes = [0, 0, 0, 0];
  const startUsage = limitOf.map(() => 0);
  push(startPos, ZERO, maskKey(ZERO), 0, null, startUsage, startRes, -1);
  visited.set(visitedKey(startPos, maskKey(ZERO), null, startUsage), store(startRes));

  // An 11-draw from `pos`: 10 normal pulls, then the guaranteed uber `gUnit`
  // (guaranteed banner) or an 11th normal pull (gUnit null). Null if it runs
  // past the table. `units` only when `keepUnits` (replaying).
  const draw11 = (pos, last, rolls, gUnit, collected, keepUnits) => {
    const units = keepUnits ? [] : null;
    const hits = [];
    let p = pos;
    let l = last;
    let c = collected;
    let seed = null;
    for (let i = gUnit ? 10 : 11; i > 0; i--) {
      const [u, np, , s] = getNextPosNormal(p, null, rolls, l);
      if (!u || !np) return null;
      let isT;
      [c, isT] = applyUnit(u, c);
      if (isT) hits.push(u);
      if (units) units.push(u);
      p = np;
      l = u;
      seed = s;
    }
    if (gUnit) {
      let isT;
      [c, isT] = applyUnit(gUnit, c);
      if (isT) hits.push(gUnit);
      if (units) units.push(gUnit);
      l = gUnit;
    }
    return { collected: c, hits, last: l, next: p, seed, units };
  };

  // The full actions of a path, rebuilt by replaying its steps from the start
  // exactly as the search took them.
  const replay = (node) => {
    const codes = [];
    for (let cur = node; cur >= 0; cur = stepParent[cur]) codes.push(stepCode[cur]);
    const actions = [];
    let pos = startPos;
    let last = null;
    let collected = ZERO;
    let ticketsUsed = 0;
    for (let i = codes.length - 1; i >= 0; i--) {
      const bIdx = codes[i] >> 1;
      const banner = banners[bIdx];
      const rolls = banner.rolls;
      const entry = rolls[pos];
      if (codes[i] & 1) {
        let act;
        let d;
        if (banner.hasGuaranteed) {
          const [gUnit, gNext, gSeed] = guaranteedFor(entry, last);
          d = draw11(pos, last, rolls, gUnit, collected, true);
          act = action(bIdx, ACTION_GUARANTEED_11, PAY_CAT_FOOD, pos, gNext, d.units, d.hits, COST_11, gSeed);
        } else {
          d = draw11(pos, last, rolls, null, collected, true);
          act = action(bIdx, ACTION_MULTI_11, PAY_CAT_FOOD, pos, d.next, d.units, d.hits, COST_11, d.seed);
        }
        actions.push(act);
        pos = act.position_to;
        last = d.last;
        collected = d.collected;
        continue;
      }
      const [unit, nextP, , seed] = getNextPosNormal(pos, entry.unit, rolls, last);
      const [c, isTarget] = applyUnit(unit, collected);
      const hits = isTarget ? [unit] : [];
      if (banner.type === BANNER_NORMAL) {
        const useTicket = ticketsUsed < rareTicketBudget;
        if (useTicket) ticketsUsed += 1;
        actions.push(action(bIdx, ACTION_SINGLE, useTicket ? PAY_RARE_TICKET : PAY_CAT_FOOD, pos, nextP,
          [unit], hits, useTicket ? COST_TICKET : COST_FOOD, seed));
      } else {
        const platinum = banner.type === BANNER_PLATINUM;
        actions.push(action(bIdx, platinum ? ACTION_PLATINUM : ACTION_LEGEND,
          platinum ? PAY_PLATINUM_TICKET : PAY_LEGEND_TICKET, pos, nextP, [unit], hits,
          platinum ? COST_PLATINUM : COST_LEGEND, seed));
      }
      pos = nextP;
      last = unit;
      collected = c;
    }
    return actions;
  };

  let solutions = [];
  let maxFound = 0;
  let iterations = 0;
  let stopped = null;
  const t0 = Date.now();

  const record = (st) => {
    const count = -st.n;
    if (count === 0) return;
    if (count > maxFound) {
      maxFound = count;
      solutions = [[replay(st.node), st.pos, st.collected]];
    } else if (count === maxFound && solutions.length < maxSolutions) {
      solutions.push([replay(st.node), st.pos, st.collected]);
    }
  };

  const expandNormal = (bIdx, banner, entry, st) => {
    const { pos, collected, mkey, last, usage, res, node } = st;
    const count = -st.n;
    const [rt, cf, pt, lt] = res;
    const k = slotOf[bIdx];
    const newUsage = k < 0 ? usage : bump(usage, k);

    // --- single pull: rare tickets first, then cat food --------------------
    const [unit, nextP] = getNextPosNormal(pos, entry.unit, banner.rolls, last);
    if (unit && nextP) {
      const [newCollected, isTarget] = applyUnit(unit, collected);
      // A rare ticket still available must be used (no cat food on singles
      // while tickets remain).
      const resS = rt < rareTicketBudget ? [rt + 1, cf, pt, lt] : [rt, cf + CAT_FOOD_PER_PULL, pt, lt];
      const newKey = isTarget ? maskKey(newCollected) : mkey;
      if (withinCaps(resS) && admit(nextP, newKey, unit, newUsage, resS)) {
        push(nextP, newCollected, newKey, count + (isTarget ? 1 : 0), unit, newUsage, resS, addStep(node, 2 * bIdx));
      }
    }

    // --- 11-roll (cat food only) -------------------------------------------
    const res11 = [rt, cf + CAT_FOOD_PER_11_DRAW, pt, lt];
    if (banner.hasGuaranteed) {
      // Guaranteed banner: the 11th cat is its guaranteed uber. (No
      // guaranteed cell here = the draw runs past the table: skip it.)
      const [gUnit, gNext] = guaranteedFor(entry, last);
      if (gUnit && gNext && withinCaps(res11)) {
        const d = draw11(pos, last, banner.rolls, gUnit, collected, false);
        const newKey = d && d.hits.length ? maskKey(d.collected) : mkey;
        if (d && admit(gNext, newKey, gUnit, newUsage, res11)) {
          push(gNext, d.collected, newKey, count + d.hits.length, gUnit, newUsage, res11, addStep(node, 2 * bIdx + 1));
        }
      }
    } else if (withinCaps(res11)) {
      // No guaranteed cells: a plain 11-roll is 11 normal pulls for 1500 food.
      const d = draw11(pos, last, banner.rolls, null, collected, false);
      const newKey = d && d.hits.length ? maskKey(d.collected) : mkey;
      if (d && admit(d.next, newKey, d.last, newUsage, res11)) {
        push(d.next, d.collected, newKey, count + d.hits.length, d.last, newUsage, res11, addStep(node, 2 * bIdx + 1));
      }
    }
  };

  // Platinum/Legend Capsules: single pulls, their own tickets, no 11-draw.
  const expandSpecial = (bIdx, banner, entry, st) => {
    const { pos, collected, mkey, last, usage, res, node } = st;
    const count = -st.n;
    const [rt, cf, pt, lt] = res;
    const [unit, nextP] = getNextPosNormal(pos, entry.unit, banner.rolls, last);
    if (!unit || !nextP) return;
    const [newCollected, isTarget] = applyUnit(unit, collected);
    const k = slotOf[bIdx];
    const newUsage = k < 0 ? usage : bump(usage, k);
    const newRes = banner.type === BANNER_PLATINUM ? [rt, cf, pt + 1, lt] : [rt, cf, pt, lt + 1];
    const newKey = isTarget ? maskKey(newCollected) : mkey;
    if (!withinCaps(newRes) || !admit(nextP, newKey, unit, newUsage, newRes)) return;
    push(nextP, newCollected, newKey, count + (isTarget ? 1 : 0), unit, newUsage, newRes, addStep(node, 2 * bIdx));
  };

  while (pq.size) {
    iterations += 1;
    if (iterations > maxSteps) {
      stopped = "steps";
      break;
    }
    if ((iterations & 1023) === 0) {
      if (timeLimitMs !== null && Date.now() - t0 > timeLimitMs) {
        stopped = "time";
        break;
      }
      if (maxStates !== null && visited.size > maxStates) {
        stopped = "states";
        break;
      }
      if (onProgress && iterations % progressEvery < 1024) onProgress({ steps: iterations, ms: Date.now() - t0 });
    }

    const st = pq.pop();
    if (mode === MODE_STRICT) {
      if (st.collected === allTargets) {
        solutions.push([replay(st.node), st.pos, st.collected]);
        if (solutions.length >= maxSolutions) break;
        continue;
      }
    } else {
      record(st);
      if (st.collected === allTargets) continue;
    }

    for (let bIdx = 0; bIdx < banners.length; bIdx++) {
      const k = slotOf[bIdx];
      if (k >= 0 && st.usage[k] >= limitOf[k]) continue;
      const banner = banners[bIdx];
      const entry = banner.rolls[st.pos];
      if (!entry) continue;
      if (banner.type === BANNER_NORMAL) expandNormal(bIdx, banner, entry, st);
      else expandSpecial(bIdx, banner, entry, st);
    }
  }

  if (stats) {
    stats.steps = Math.min(iterations, maxSteps);
    stats.stopped = stopped;
    stats.ms = Date.now() - t0;
    stats.states = visited.size;
    stats.queued = pq.size;
  }
  return buildSolutions(solutions);
}

function coerceBanners(banners) {
  return [...banners].map((b, i) => {
    if (b instanceof Banner) return b;
    if (b && typeof b === "object" && "rolls" in b) return new Banner(b.name ?? `Banner ${i + 1}`, b.rolls, b.type);
    if (b && typeof b === "object") return new Banner(`Banner ${i + 1}`, b, BANNER_NORMAL);
    throw new TypeError(`Banner ${i} is not a Banner or roll table`);
  });
}

function buildSolutions(rawSolutions) {
  const out = [];
  const seen = new Set();
  for (const [allActions, , collected] of rawSolutions) {
    // Trim trailing actions that collect no new target: a path's job is done
    // at the last target it picks up; anything after only wastes resources.
    let lastHit = -1;
    allActions.forEach((a, i) => {
      if (a.targets_hit.length) lastHit = i;
    });
    if (lastHit < 0) continue;
    const actions = allActions.slice(0, lastHit + 1);

    // Distinct trimmed paths only (different routes can pad to the same one).
    const sig = actions.map((a) => `${a.banner_index},${a.action_type},${a.position_from},${a.position_to}`).join(";");
    if (seen.has(sig)) continue;
    seen.add(sig);

    const total = emptyResources();
    const collectedUnits = [];
    for (const a of actions) {
      for (const k of RESOURCE_KEYS) total[k] += a.cost[k] || 0;
      collectedUnits.push(...a.targets_hit);
    }
    out.push({
      actions,
      cost: total,
      final_position: actions[actions.length - 1].position_to,
      collected_count: popcount(collected),
      collected_units: collectedUnits,
      final_seed: actions[actions.length - 1].result_seed,
    });
  }
  // Most collected first, then cheapest by scalarised cost (a stable sort).
  const key = (s) => scalar(RESOURCE_KEYS.map((k) => s.cost[k]));
  out.sort((a, b) => b.collected_count - a.collected_count || key(a) - key(b));
  return out;
}

// --------------------------------------------------------------------------- //
// Verification: re-simulate a solution against the banners
// --------------------------------------------------------------------------- //

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Walk each action from 1A, recompute its unit(s) and next position, and check
// they match what the solution claims. Returns [ok, errors].
export function verifySolution(banners, solution) {
  banners = coerceBanners(banners);
  const errors = [];
  let pos = "1A";
  let lastUnit = null;
  const fail = (msg) => {
    errors.push(msg);
    return [false, errors];
  };
  for (const [i, act] of solution.actions.entries()) {
    const step = i + 1;
    if (act.banner_index < 0 || act.banner_index >= banners.length) return fail(`Step ${step}: invalid banner index ${act.banner_index}`);
    const banner = banners[act.banner_index];
    if (act.position_from !== pos) return fail(`Step ${step}: position_from ${act.position_from} != actual ${pos}`);
    if (!(pos in banner.rolls)) return fail(`Step ${step}: position ${pos} not in banner ${act.banner_index}`);

    if (act.action_type === ACTION_GUARANTEED_11) {
      const [gUnit, gNext] = guaranteedFor(banner.rolls[pos], lastUnit);
      if (!gUnit || !gNext) return fail(`Step ${step}: no guaranteed roll at ${pos}`);
      const units = [];
      let p = pos;
      let l = lastUnit;
      for (let k = 0; k < 10; k++) {
        const [u, np] = getNextPosNormal(p, null, banner.rolls, l);
        if (!u || !np) return fail(`Step ${step}: 11-draw simulation failed at ${pos}`);
        units.push(u);
        p = np;
        l = u;
      }
      units.push(gUnit);
      if (!sameList(units, act.units_pulled)) return fail(`Step ${step}: 11-draw units mismatch at ${pos}: ${act.units_pulled} != ${units}`);
      if (gNext !== act.position_to) return fail(`Step ${step}: 11-draw next ${gNext} != ${act.position_to}`);
      pos = gNext;
      lastUnit = gUnit;
    } else if (act.action_type === ACTION_MULTI_11) {
      const units = [];
      let p = pos;
      let l = lastUnit;
      for (let k = 0; k < 11; k++) {
        const [u, np] = getNextPosNormal(p, null, banner.rolls, l);
        if (!u || !np) return fail(`Step ${step}: 11-roll simulation failed at ${pos}`);
        units.push(u);
        p = np;
        l = u;
      }
      if (!sameList(units, act.units_pulled)) return fail(`Step ${step}: 11-roll units mismatch at ${pos}: ${act.units_pulled} != ${units}`);
      if (p !== act.position_to) return fail(`Step ${step}: 11-roll next ${p} != ${act.position_to}`);
      pos = p;
      lastUnit = units[units.length - 1];
    } else {
      // single pull (normal/platinum/legend)
      const [unit, nextP] = getNextPosNormal(pos, null, banner.rolls, lastUnit);
      if (!unit || !nextP) return fail(`Step ${step}: could not simulate single pull at ${pos}`);
      if (!sameList([unit], act.units_pulled)) return fail(`Step ${step}: unit mismatch at ${pos}: ${act.units_pulled} != ${unit}`);
      if (nextP !== act.position_to) return fail(`Step ${step}: next ${nextP} != ${act.position_to}`);
      pos = nextP;
      lastUnit = unit;
    }
  }
  if (pos !== solution.final_position) return fail(`Final position ${pos} != solution.final_position ${solution.final_position}`);
  return [true, errors];
}

// --------------------------------------------------------------------------- //
// Table cells a solution pulls (for drawing the path on the track table)
// --------------------------------------------------------------------------- //

export const CELL_UNIT = "unit"; // the cell's normal result
export const CELL_ALT = "alt"; // its duplicate result (track switch)
export const CELL_GUARANTEED = "guaranteed"; // the 11-draw's guaranteed column
export const CELL_ALT_GUARANTEED = "alt_guaranteed"; // ...its dupe version

// For each action, the cells it pulls, in order: [{pos, result}]. A single
// pull is one cell, a plain 11-roll eleven, a guaranteed 11-draw its ten
// normal pulls plus the guaranteed column of the row it starts on (its dupe
// line when the first pull was a dupe). Walks the path like `verifySolution`.
export function solutionCells(banners, solution) {
  banners = coerceBanners(banners);
  const out = [];
  let pos = "1A";
  let lastUnit = null;
  for (const act of solution.actions) {
    const rolls = banners[act.banner_index].rolls;
    const cells = [];
    const pull = (p, last) => {
      const [unit, nextP, note] = getNextPosNormal(p, null, rolls, last);
      cells.push({ pos: p, result: note === "Duplicate" ? CELL_ALT : CELL_UNIT });
      return [unit, nextP];
    };
    if (act.action_type === ACTION_GUARANTEED_11) {
      const entry = rolls[pos] || {};
      const [gUnit, gNext] = guaranteedFor(entry, lastUnit);
      // Same rule as guaranteedFor: a dupe first pull takes the RG cell.
      const dupeFirst = Boolean(lastUnit) && entry.unit === lastUnit && "alt_unit" in entry;
      let p = pos;
      let last = lastUnit;
      for (let k = 0; k < 10; k++) [last, p] = pull(p, last);
      cells.push({ pos, result: dupeFirst ? CELL_ALT_GUARANTEED : CELL_GUARANTEED });
      pos = gNext;
      lastUnit = gUnit;
    } else {
      const n = act.action_type === ACTION_MULTI_11 ? 11 : 1;
      for (let k = 0; k < n; k++) [lastUnit, pos] = pull(pos, lastUnit);
    }
    out.push(cells);
  }
  return out;
}
