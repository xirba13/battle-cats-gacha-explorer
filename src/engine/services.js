// What the app's old server did, now in the browser: targets, the search
// result the page shows, and "I followed this path". Stateless: the page
// passes in the player's state (owned units, seed, resources) and gets the new
// state.

import { catOfUid, ingest, uidOfCat } from "./data.js";
import { NameMatcher, normalize } from "./names.js";
import * as pathfinder from "./pathfinder.js";
import { LEGEND } from "./rolls.js";

export const DISCLAIMER =
  "This tool is experimental and not fully tested. Every path is re-simulated " +
  "against the roll tables before being shown, but ALWAYS check a path " +
  "on bc.godfat.org before spending real resources.";

export const DEFAULT_COUNT = 100;
// Deepest table a search can ask for (the page allows 1000).
export const MAX_COUNT = 1000;

// How deep the roll tables should be for these resources: the pulls they buy
// (rare tickets, 11 per 1500 cat food plus singles with the rest, Platinum and
// Legend tickets) plus 20 rows for dupe jumps; at least the old default of
// 100 rows (to look ahead), at most MAX_COUNT. A path can't go deeper than
// the pulls it pays for, so this lets the best paths use all your resources.
export function autoDepth(resources) {
  const r = pathfinder.normalizeResources(resources);
  const draws = Math.floor(r.cat_food / pathfinder.CAT_FOOD_PER_11_DRAW);
  const singles = Math.floor((r.cat_food % pathfinder.CAT_FOOD_PER_11_DRAW) / pathfinder.CAT_FOOD_PER_PULL);
  const pulls = r.rare_tickets + 11 * draws + singles + r.platinum_tickets + r.legend_tickets;
  return Math.min(MAX_COUNT, Math.max(DEFAULT_COUNT, pulls + 20));
}

// Search-iteration cap, as on the server.
export const MAX_STEPS = 1_500_000;

// The Cat Guide list (public/data/cat_guide_master.json).
export class MasterData {
  constructor(payload) {
    this.meta = payload._meta || {};
    this.units = payload.units;
    this.byIndex = new Map(this.units.map((u) => [u.global_index, u]));
    this.matcher = new NameMatcher(this.units);
  }

  indexForName(godfatName) {
    const unit = this.matcher.match(godfatName);
    return unit ? unit.global_index : null;
  }
}

const UNIT_KEYS = ["unit", "alt_unit", "guaranteed_unit", "alt_guaranteed_unit"];

// Targets = unique unit names across the banners, minus owned units; or, with
// a wishlist (godfat or master names), exactly the wishlist's units in the
// banners, owned or not (the wishlist wins: you may want another copy).
// Matching goes godfat name -> master -> global_index to decide ownership;
// the godfat name stays the search target (the tables use it). `ordered`:
// the targets come in the wishlist's order (most wanted first).
export function computeTargets(banners, master, owned, wishlist = null, { ordered = false } = {}) {
  const seen = new Set();
  const targets = [];
  const ownedNames = [];
  const unmatched = [];
  const wish = wishlist ? new Set(wishlist.map(normalize)) : null;
  for (const banner of banners) {
    for (const entry of Object.values(banner.rolls)) {
      for (const key of UNIT_KEYS) {
        const name = entry[key];
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const idx = master.indexForName(name);
        // Unknown to the master => can't confirm ownership => a candidate.
        if (idx === null) unmatched.push(name);
        const isOwned = idx !== null && owned.has(idx);
        if (wish !== null) {
          if (wish.has(normalize(name))) targets.push(name); // wished for: a target even if owned
          else if (isOwned) ownedNames.push(name);
          continue;
        }
        if (isOwned) {
          ownedNames.push(name);
          continue;
        }
        targets.push(name);
      }
    }
  }
  if (ordered && wishlist) {
    const rank = new Map();
    wishlist.forEach((n, i) => rank.has(normalize(n)) || rank.set(normalize(n), i));
    targets.sort((a, b) => rank.get(normalize(a)) - rank.get(normalize(b)));
  }
  return { targets, owned_in_banners: ownedNames, unmatched };
}

// Cap special banners by the player's ticket budget.
export function bannerLimitsFor(banners, resources) {
  const limits = new Map();
  banners.forEach((b, i) => {
    if (b.type === pathfinder.BANNER_PLATINUM) limits.set(i, resources.platinum_tickets ?? 0);
    else if (b.type === pathfinder.BANNER_LEGEND) limits.set(i, resources.legend_tickets ?? 0);
  });
  return limits;
}

// What the track table shows per position (the seeds aren't needed there).
const TABLE_KEYS = ["unit", "alt_unit", "alt_next", "guaranteed_unit", "guaranteed_next",
  "alt_guaranteed_unit", "alt_guaranteed_next"];

function tableRolls(banner) {
  const out = {};
  for (const [pos, e] of Object.entries(banner.rolls)) {
    const row = {};
    for (const k of TABLE_KEYS) if (e[k]) row[k] = e[k];
    out[pos] = row;
  }
  return out;
}

// Rarity and Cat Guide index of every unit in the tables, by godfat name, so
// the table can colour cells and mark what you own.
function unitInfo(banners, master) {
  const info = {};
  for (const banner of banners) {
    for (const entry of Object.values(banner.rolls)) {
      for (const key of UNIT_KEYS) {
        const name = entry[key];
        if (!name || Object.hasOwn(info, name)) continue;
        const unit = master.matcher.match(name);
        info[name] = { rarity: unit ? unit.rarity_godfat ?? null : null, global_index: unit ? unit.global_index : null };
      }
    }
  }
  return info;
}

function annotateUnits(names, master) {
  return names.map((n) => {
    const unit = master.matcher.match(n);
    return {
      godfat_name: n,
      master_name: unit ? unit.name : null,
      global_index: unit ? unit.global_index : null,
      rarity: unit ? unit.rarity_godfat ?? null : null,
    };
  });
}

// The roll tables, their units and the paths, as the page shows them; every
// path is checked again before it's shown (experimental-tool safety net).
function describe(banners, master, solutions) {
  return {
    banners: banners.map((b, i) => ({ index: i, name: b.name, type: b.type, positions: Object.keys(b.rolls).length, rolls: tableRolls(b) })),
    units: unitInfo(banners, master),
    solutions: solutions.map((sol) => {
      const [ok, errors] = pathfinder.verifySolution(banners, sol);
      return {
        ...sol,
        verified: ok,
        verify_errors: errors,
        units_pulled_all: annotateUnits(sol.actions.flatMap((a) => a.units_pulled), master),
        // The roll-table cells each action pulls, for the track table view.
        cells: pathfinder.solutionCells(banners, sol),
      };
    }),
  };
}

// Never skip a Legend Rare: the spots where a searched banner has one, but
// not the Legend Capsule (they're common there), and what counts as getting
// it: a pull there that gives any Legend Rare (the Capsule's too).
export function legendRareSpots(dataset, banners) {
  const isLegend = (name) => dataset.rarityOf(name) === LEGEND;
  const at = new Set();
  for (const b of banners) {
    if (b.type === pathfinder.BANNER_LEGEND) continue;
    for (const [pos, cell] of Object.entries(b.rolls)) if (isLegend(cell.unit)) at.add(pos);
  }
  return { at, keep: isLegend };
}

// Run the path search on built banners; the result the page shows. With a
// wishlist, `ranking` can rank paths by its order (see pathfinder.RANKINGS);
// `noSkip`: units not to skip (see pathfinder.findPaths).
export function runSearch(banners, master, owned, resources, {
  wishlist = null,
  ranking = pathfinder.RANK_COUNT,
  noSkip = null,
  mode = pathfinder.MODE_RESOURCE_LIMIT,
  maxSteps = MAX_STEPS,
  maxSolutions = 20,
  timeLimitMs = null,
  maxStates = null,
  onProgress = null,
} = {}) {
  const res = pathfinder.normalizeResources(resources);
  if (wishlist === null) ranking = pathfinder.RANK_COUNT;
  const report = computeTargets(banners, master, owned, wishlist, { ordered: ranking !== pathfinder.RANK_COUNT });
  const stats = {};
  const solutions = pathfinder.findPaths(banners, report.targets, {
    resources: res, bannerLimits: bannerLimitsFor(banners, res), mode, ranking, noSkip, maxSteps, maxSolutions,
    timeLimitMs, maxStates, onProgress, stats,
  });
  return {
    targets: report.targets,
    owned_in_banners: report.owned_in_banners,
    unmatched: [...new Set(report.unmatched)].sort(),
    ...describe(banners, master, solutions),
    // How the search went: steps taken, states kept, and "steps" / "time" /
    // "states" if a cap stopped it (then cheaper paths may exist).
    search: stats,
  };
}

// Stateless "I followed this path": every unit pulled becomes owned, the seed
// is the one after the last action, and the path's cost is spent.
export function followedResult(master, solution, owned, resources = null) {
  const pulled = new Set();
  const unmatched = new Set();
  for (const act of solution.actions || []) {
    for (const name of act.units_pulled || []) {
      const unit = master.matcher.match(name);
      if (unit) pulled.add(unit.global_index);
      else unmatched.add(name);
    }
  }
  const ownedSet = new Set(owned);
  const byNumber = (a, b) => a - b;
  const newly = [...pulled].filter((i) => !ownedSet.has(i)).sort(byNumber); // real additions only
  const newOwned = [...new Set([...ownedSet, ...pulled])].sort(byNumber);

  // Resources after spending the path's cost (floored at 0).
  let newResources = null;
  if (resources) {
    const res = pathfinder.normalizeResources(resources);
    const spent = solution.cost || {};
    newResources = Object.fromEntries(pathfinder.RESOURCE_KEYS.map((k) => [k, Math.max(0, res[k] - Math.trunc(spent[k] || 0))]));
  }
  return {
    owned: newOwned,
    new_seed: solution.final_seed ?? null,
    units_added_count: newly.length,
    units_pulled_count: pulled.size,
    units_added: newly.map((i) => ({ global_index: i, name: master.byIndex.get(i).name })),
    unmatched_units: [...unmatched].sort(),
    resources: newResources,
  };
}

// --------------------------------------------------------------------------- //
// The requests the page makes (what main.py's endpoints did)
// --------------------------------------------------------------------------- //

export function dataInfo(dataset) {
  return { source: "local", built_on: dataset.meta.built_on ?? null };
}

// The Upcoming banners (the seed doesn't change them), each with the units it
// can give (Cat Guide uids).
export function eventsRequest(dataset, seed, { today } = {}) {
  const events = dataset.upcoming(today).map((e) => ({ ...e, uids: dataset.catsOf(e.event_id).map(uidOfCat) }));
  return { seed, events, data: dataInfo(dataset) };
}

// A wishlist from the Wishlist tab, for a search: its ticked units' names in
// the tables (godfat's cat id for a unit gives the exact name they use), most
// wanted first, and their places in the list (#1…) by name, for the page.
function wishFor(dataset, wish) {
  const names = [];
  const ranks = {};
  (wish.units || []).forEach((w, i) => {
    const cat = catOfUid(w.uid);
    if (w.on === false || !dataset.cats.has(cat)) return;
    const name = dataset.nameOf(cat);
    names.push(name);
    ranks[name] = i + 1;
  });
  return { names, ranks };
}

// A search: build the selected banners for the seed, then find paths. The
// targets: `body.wish` ({units: [{uid, on}], most wanted first, ranking}, from
// the Wishlist tab: its ticked units), or `body.wishlist` (names, ranked by
// count), or else every unit you don't own. `body.keep_legends`: never skip a
// Legend Rare (legendRareSpots).
// Throws on a seed that isn't a number from 0 to 2^32 - 1.
export function searchRequest(dataset, master, body, {
  today, timeLimitMs = null, maxStates = null, onProgress = null, maxSteps = MAX_STEPS,
} = {}) {
  const resources = pathfinder.normalizeResources(body.resources);
  const count = Math.max(1, Math.min(body.count ?? DEFAULT_COUNT, MAX_COUNT));
  const ingestion = ingest(dataset, body.seed, count, { resources, eventIds: body.event_ids, today });
  let wishlist = body.wishlist ?? null;
  let ranking = pathfinder.RANK_COUNT;
  let ranks = null;
  if (body.wish?.units?.some((w) => w.on !== false)) {
    ({ names: wishlist, ranks } = wishFor(dataset, body.wish));
    ranking = body.wish.ranking ?? pathfinder.RANK_ORDER;
  }
  const result = runSearch(ingestion.banners, master, new Set(body.owned || []), resources, {
    wishlist,
    ranking,
    noSkip: body.keep_legends ? legendRareSpots(dataset, ingestion.banners) : null,
    mode: body.mode ?? pathfinder.MODE_RESOURCE_LIMIT,
    maxSolutions: body.max_solutions ?? 20,
    maxSteps,
    timeLimitMs,
    maxStates,
    onProgress,
  });
  return {
    ...result, seed: body.seed, wishlist, ranking: wishlist ? ranking : pathfinder.RANK_COUNT, wish_ranks: ranks,
    keep_legends: Boolean(body.keep_legends), skipped: ingestion.skipped,
    // What a saved plan needs to build these tables again.
    depth: count, event_ids: ingestion.banners.map((b) => b.eventId), resources,
    data: dataInfo(dataset), disclaimer: DISCLAIMER,
  };
}

export function followedRequest(master, { solution, owned = [], resources = null }) {
  // Every unit the path pulls (Cat Guide uids), so the page can offer to take
  // them off your wishlists.
  const pulled = new Set();
  for (const act of solution.actions || []) {
    for (const name of act.units_pulled || []) {
      const unit = master.matcher.match(name);
      if (unit) pulled.add(unit.uid);
    }
  }
  return {
    ...followedResult(master, solution, owned, resources),
    pulled_uids: [...pulled],
    prompt: "Path recorded. Your new seed has been filled in automatically — verify it on bc.godfat.org, then search again.",
  };
}

// --------------------------------------------------------------------------- //
// Saved plans
// --------------------------------------------------------------------------- //

// FNV-1a (32 bits) of the units a path pulls, in order: a saved plan keeps it
// to notice when the banner data changed under it.
export function unitsHash(units) {
  let h = 0x811c9dc5;
  for (const u of units) {
    for (const ch of `${u}\u0001`) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

// A search result's path, saved as a plan: what builds it again (the seed,
// table depth, its banners in order, the rare tickets it was planned with and
// its steps), which of the units it pulls are its targets (bits over the
// different units, in the order they're first pulled) and a hash of all it
// pulls.
export function planOf(result, solution) {
  const pulled = solution.actions.flatMap((a) => a.units_pulled);
  const distinct = [...new Set(pulled)];
  const hit = new Set(solution.collected_units);
  const hits = new Uint8Array(Math.ceil(distinct.length / 8));
  distinct.forEach((u, i) => {
    if (hit.has(u)) hits[i >> 3] |= 1 << (i & 7);
  });
  return {
    seed: String(result.seed),
    depth: result.depth,
    rareTickets: result.resources.rare_tickets,
    events: result.event_ids,
    steps: pathfinder.stepsOf(solution),
    hits,
    check: unitsHash(pulled),
  };
}

// A saved plan, built again from today's data: its banners' roll tables and
// its path, replayed from its steps, shaped like a search result. `problem`:
// "gone" (a banner left the data: it's over), "broken" (the steps don't fit
// the tables any more) or "changed" (the banner data changed, so the path may
// not pull what it did, and its targets aren't known).
export function planRequest(dataset, master, plan) {
  const base = {
    plan: true, seed: plan.seed, depth: plan.depth, event_ids: plan.events,
    data: dataInfo(dataset), disclaimer: DISCLAIMER,
  };
  const depth = Math.max(1, Math.min(plan.depth, MAX_COUNT));
  const banners = plan.events.map((id) => dataset.banner(plan.seed, id, depth));
  if (banners.some((b) => b === null)) return { ...base, problem: "gone" };
  const replay = (isTarget) => pathfinder.replaySteps(banners, plan.steps, { rareTickets: plan.rareTickets, isTarget });
  const first = replay(undefined);
  if (!first) return { ...base, problem: "broken" };
  const pulled = first.flatMap((a) => a.units_pulled);
  const changed = unitsHash(pulled) !== plan.check;
  const targets = changed ? [] : [...new Set(pulled)].filter((_, i) => plan.hits[i >> 3] & (1 << (i & 7)));
  const actions = replay((u) => targets.includes(u));
  return {
    ...base,
    problem: changed ? "changed" : null,
    targets,
    // Each target's Cat Guide uid, to find it on a wishlist.
    target_uids: Object.fromEntries(targets.map((name) => {
      const id = dataset.catIdOf(name);
      return [name, id === null ? null : uidOfCat(id)];
    })),
    ...describe(banners, master, [pathfinder.summarize(actions)]),
  };
}
