// What the server used to do, now in the browser: targets, the search result
// the page shows, and "I followed this path". Ports backend/app/services.py
// and the request handling of backend/app/main.py. Stateless: the page passes
// in the player's state (owned units, seed, resources) and gets the new state.

import { ingest } from "./data.js";
import { NameMatcher, normalize } from "./names.js";
import * as pathfinder from "./pathfinder.js";

export const DISCLAIMER =
  "This tool is experimental and not fully tested. Every path is re-simulated " +
  "against the roll tables before being shown, but ALWAYS check a path " +
  "on bc.godfat.org before spending real resources.";

export const DEFAULT_COUNT = 100;
// Deepest table a search can ask for (the page allows 1000).
export const MAX_COUNT = 1000;
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

// Targets = unique unit names across the banners, minus owned units. Matching
// goes godfat name -> master -> global_index to decide ownership; the godfat
// name stays the search target (the tables use it). A wishlist (godfat or
// master names) optionally narrows the targets.
export function computeTargets(banners, master, owned, wishlist = null) {
  const seen = new Set();
  const targets = [];
  const ownedNames = [];
  const unmatched = [];
  const wish = wishlist && wishlist.length ? new Set(wishlist.map(normalize)) : null;
  for (const banner of banners) {
    for (const entry of Object.values(banner.rolls)) {
      for (const key of UNIT_KEYS) {
        const name = entry[key];
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const idx = master.indexForName(name);
        // Unknown to the master => can't confirm ownership => a candidate.
        if (idx === null) unmatched.push(name);
        if (idx !== null && owned.has(idx)) {
          ownedNames.push(name);
          continue;
        }
        if (wish !== null && !wish.has(normalize(name))) continue;
        targets.push(name);
      }
    }
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

// Run the path search on built banners; the result the page shows.
export function runSearch(banners, master, owned, resources, {
  wishlist = null,
  mode = pathfinder.MODE_RESOURCE_LIMIT,
  maxSteps = MAX_STEPS,
  maxSolutions = 20,
  timeLimitMs = null,
  maxStates = null,
  onProgress = null,
} = {}) {
  const res = pathfinder.normalizeResources(resources);
  const report = computeTargets(banners, master, owned, wishlist);
  const stats = {};
  const solutions = pathfinder.findPaths(banners, report.targets, {
    resources: res, bannerLimits: bannerLimitsFor(banners, res), mode, maxSteps, maxSolutions,
    timeLimitMs, maxStates, onProgress, stats,
  });
  // Re-validate every solution before showing it (experimental-tool safety net).
  const validated = solutions.map((sol) => {
    const [ok, errors] = pathfinder.verifySolution(banners, sol);
    return {
      ...sol,
      verified: ok,
      verify_errors: errors,
      units_pulled_all: annotateUnits(sol.actions.flatMap((a) => a.units_pulled), master),
      // The roll-table cells each action pulls, for the track table view.
      cells: pathfinder.solutionCells(banners, sol),
    };
  });
  return {
    targets: report.targets,
    owned_in_banners: report.owned_in_banners,
    unmatched: [...new Set(report.unmatched)].sort(),
    banners: banners.map((b, i) => ({ index: i, name: b.name, type: b.type, positions: Object.keys(b.rolls).length, rolls: tableRolls(b) })),
    units: unitInfo(banners, master),
    solutions: validated,
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

// The Upcoming banners (the seed doesn't change them).
export function eventsRequest(dataset, seed, { today } = {}) {
  return { seed, events: dataset.upcoming(today), data: dataInfo(dataset) };
}

// A search: build the selected banners for the seed, then find paths.
// Throws on a seed that isn't a number from 0 to 2^32 - 1.
export function searchRequest(dataset, master, body, {
  today, timeLimitMs = null, maxStates = null, onProgress = null, maxSteps = MAX_STEPS,
} = {}) {
  const resources = pathfinder.normalizeResources(body.resources);
  const count = Math.max(1, Math.min(body.count ?? DEFAULT_COUNT, MAX_COUNT));
  const ingestion = ingest(dataset, body.seed, count, { resources, eventIds: body.event_ids, today });
  const result = runSearch(ingestion.banners, master, new Set(body.owned || []), resources, {
    wishlist: body.wishlist ?? null,
    mode: body.mode ?? pathfinder.MODE_RESOURCE_LIMIT,
    maxSolutions: body.max_solutions ?? 20,
    maxSteps,
    timeLimitMs,
    maxStates,
    onProgress,
  });
  return { ...result, seed: body.seed, skipped: ingestion.skipped, data: dataInfo(dataset), disclaimer: DISCLAIMER };
}

export function followedRequest(master, { solution, owned = [], resources = null }) {
  return {
    ...followedResult(master, solution, owned, resources),
    prompt: "Path recorded. Your new seed has been filled in automatically — verify it on bc.godfat.org, then search again.",
  };
}
