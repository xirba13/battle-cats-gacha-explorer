// Wishlists (src/wishlists.js), searching for one (engine/services.js), never
// skipping a Legend Rare, and saved plans (services planOf / planRequest,
// src/plancode.js), on the data recorded in tests/fixtures/golden.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Dataset, catOfUid, ingest } from "../src/engine/data.js";
import { normalize } from "../src/engine/names.js";
import * as pf from "../src/engine/pathfinder.js";
import { LEGEND } from "../src/engine/rolls.js";
import {
  MasterData, eventsRequest, followedRequest, legendRareSpots, planOf, planRequest, searchRequest,
} from "../src/engine/services.js";
import { base64urlToBytes, bytesToBase64url } from "../src/bytes.js";
import { MAX_PLANS, decodePlan, decodePlans, encodePlan, encodePlans, nextPlanName } from "../src/plancode.js";
import * as wl from "../src/wishlists.js";

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (...parts) => JSON.parse(readFileSync(join(here, ...parts), "utf8"));
const golden = readJson("fixtures", "golden.json");
const data = golden.datasets.now;
const dataset = new Dataset(data);
const master = new MasterData(golden.master);
const uidOf = (name) => master.units.find((u) => u.name === name).uid;

const TODAY = "2026-10-23";
const EVENTS = ["2026-10-16_1071", "2026-10-16_1072", "2026-10-20_1070", "2026-10-23_1015", "2026-10-23_946"];
const RESOURCES = { rare_tickets: 30, cat_food: 45000, platinum_tickets: 2, legend_tickets: 2 };
const WISHED = ["Lone Moon Lunos", "Sorceress Sidmi", "Hanasaka Cat"]; // most wanted first
const search = (wish, extra = {}) => searchRequest(dataset, master, {
  seed: "139026851", event_ids: EVENTS, count: 100, resources: RESOURCES, owned: [], wish, ...extra,
}, { today: TODAY });
const wishOf = (names, ranking = "order", off = []) =>
  ({ ranking, units: names.map((n) => ({ uid: uidOf(n), on: !off.includes(n) })) });

// --- Searching for a wishlist -----------------------------------------------------

test("godfat's cat ids are the Cat Guide's uids + 1", () => {
  // Wishlists keep uids; a search finds their names in the tables by id. Any
  // cat whose name matches the Cat Guide list must agree on the id.
  const shipped = readJson("..", "public", "data", "godfat_bcen.json");
  const full = new MasterData(readJson("..", "public", "data", "cat_guide_master.json"));
  const byName = new Map(full.units.map((u) => [normalize(u.name), u]));
  let matched = 0;
  for (const [id, [name]] of Object.entries(shipped.cats)) {
    const unit = byName.get(normalize(name));
    if (!unit) continue;
    matched++;
    assert.equal(catOfUid(unit.uid), Number(id), name);
  }
  assert.ok(matched > 0.9 * Object.keys(shipped.cats).length);
});

test("a wishlist search targets its units, most wanted first", () => {
  const r = search(wishOf(WISHED));
  assert.deepEqual(r.targets, WISHED);
  assert.equal(r.ranking, "order");
  assert.deepEqual(r.wish_ranks, { "Lone Moon Lunos": 1, "Sorceress Sidmi": 2, "Hanasaka Cat": 3 });
  assert.deepEqual([...r.solutions[0].collected_units].sort(), [...WISHED].sort());
  for (const s of r.solutions) assert.ok(s.verified, s.verify_errors.join("; "));
  // What a plan needs: the depth and the banners, in the search's order.
  assert.equal(r.depth, 100);
  assert.deepEqual(r.event_ids, EVENTS);
});

test("unticked units aren't searched; with none ticked, every unit you don't own is", () => {
  const r = search(wishOf(WISHED, "most", ["Sorceress Sidmi"]));
  assert.deepEqual(r.targets, ["Lone Moon Lunos", "Hanasaka Cat"]);
  assert.deepEqual(r.wish_ranks, { "Lone Moon Lunos": 1, "Hanasaka Cat": 3 });
  assert.equal(r.ranking, "most");
  const none = search(wishOf(WISHED, "order", WISHED), { max_solutions: 1 });
  assert.equal(none.ranking, "count");
  assert.equal(none.wishlist, null);
  assert.ok(none.targets.length > 50);
});

test("a wished unit that isn't in the banners is no target", () => {
  // The basic Cat (uid 0) is in no gacha; Hanasaka Cat keeps its place (#2).
  const r = search({ ranking: "order", units: [{ uid: 0, on: true }, { uid: uidOf("Hanasaka Cat"), on: true }] });
  assert.deepEqual(r.targets, ["Hanasaka Cat"]);
  assert.deepEqual(r.wish_ranks, { "Hanasaka Cat": 2 });
});

test("the Upcoming list says which units each banner can give", () => {
  const { events } = eventsRequest(dataset, "1", { today: TODAY });
  const platinum = events.find((e) => e.banner_type === "platinum");
  const ubers = new Set(master.units.filter((u) => u.rarity_godfat === "Uber Rare").map((u) => u.uid));
  assert.ok(platinum.uids.length > 0);
  assert.ok(platinum.uids.every((uid) => ubers.has(uid) || !master.units.some((u) => u.uid === uid)));
  for (const e of events) {
    const gacha = new Set(data.gacha[String(data.events[e.event_id].id)]);
    assert.ok(e.uids.every((uid) => gacha.has(catOfUid(uid))), e.event_id);
  }
});

test('"I followed this path" lists every unit pulled, by uid', () => {
  const sol = search(wishOf(WISHED)).solutions[0];
  const res = followedRequest(master, { solution: sol, owned: [] });
  for (const name of WISHED) assert.ok(res.pulled_uids.includes(uidOf(name)), name);
});

// --- Saved plans --------------------------------------------------------------------

const roundTrip = (plan) => decodePlan(encodePlan({ ...plan, savedOn: "2026-10-24" }));

test("a saved plan builds the same path again, through its code", () => {
  for (const wish of [wishOf(WISHED), null]) {
    const r = search(wish, { max_solutions: 3 });
    for (const sol of r.solutions) {
      const plan = roundTrip(planOf(r, sol));
      assert.equal(plan.savedOn, "2026-10-24");
      const back = planRequest(dataset, master, plan);
      assert.equal(back.problem, null);
      assert.deepEqual(back.banners, r.banners);
      const again = back.solutions[0];
      assert.ok(again.verified);
      for (const k of ["actions", "cost", "collected_units", "final_position", "final_seed", "cells"]) {
        assert.deepEqual(again[k], sol[k], k);
      }
      assert.deepEqual(back.targets, [...new Set(sol.actions.flatMap((a) => a.units_pulled))].filter((u) => sol.collected_units.includes(u)));
      if (wish) assert.deepEqual(back.target_uids, Object.fromEntries(back.targets.map((n) => [n, uidOf(n)])));
    }
  }
});

test("a plan notices when its banner data changed or is gone", () => {
  const r = search(wishOf(WISHED), { max_solutions: 1 });
  const plan = planOf(r, r.solutions[0]);
  // The pool of the banner it starts on changes (its cat list reversed): the
  // pulls differ.
  const changed = structuredClone(data);
  const gid = String(changed.events[plan.events[plan.steps[0] >> 1]].id);
  changed.gacha[gid] = [...changed.gacha[gid]].reverse();
  const back = planRequest(new Dataset(changed), master, plan);
  assert.ok(["changed", "broken"].includes(back.problem), back.problem);
  if (back.problem === "changed") assert.deepEqual(back.targets, []);
  // A banner left the data.
  const gone = structuredClone(data);
  delete gone.events["2026-10-23_1015"];
  assert.equal(planRequest(new Dataset(gone), master, plan).problem, "gone");
});

test("a broken plan code is no plan", () => {
  const r = search(wishOf(WISHED), { max_solutions: 1 });
  const code = encodePlan({ ...planOf(r, r.solutions[0]), savedOn: "2026-10-24" });
  assert.ok(decodePlan(code));
  assert.equal(decodePlan(""), null);
  assert.equal(decodePlan("not a code"), null);
  assert.equal(decodePlan(code.slice(0, 20)), null);
  // A step on a banner the plan doesn't have.
  assert.equal(decodePlan(encodePlan({ ...planOf(r, r.solutions[0]), steps: [2 * EVENTS.length], savedOn: "2026-10-24" })), null);
});

test("several plans, with their names, in one code", () => {
  const r = search(wishOf(WISHED), { max_solutions: 3 });
  const plans = r.solutions.map((sol, i) => ({ ...planOf(r, sol), savedOn: "2026-10-25", name: i ? `Plan ${i + 1}` : "Ubers first" }));
  const back = decodePlans(encodePlans(plans));
  assert.deepEqual(back.map((p) => p.name), plans.map((p) => p.name));
  assert.deepEqual(back.map((p) => p.steps), plans.map((p) => p.steps));
  assert.deepEqual(decodePlans(""), []);
  // A broken one is left out; there are at most MAX_PLANS.
  assert.equal(decodePlans(`${encodePlans(plans)}.nope`).length, plans.length);
  assert.equal(decodePlans(encodePlans(Array(MAX_PLANS + 2).fill(plans[0]))).length, MAX_PLANS);
  assert.equal(nextPlanName(plans), `Plan ${plans.length + 1}`);
  assert.equal(nextPlanName([]), "Plan 1");
});

test("a plan saved before plans had names gets one", () => {
  // The same plan in format 2: no name at its end.
  const r = search(wishOf(WISHED), { max_solutions: 1 });
  const bytes = base64urlToBytes(encodePlan({ ...planOf(r, r.solutions[0]), savedOn: "2026-10-25", name: "" }));
  bytes[0] = 2;
  const old = bytesToBase64url(bytes.subarray(0, bytes.length - 1));
  assert.equal(decodePlan(old).name, null);
  assert.deepEqual(decodePlans(old).map((p) => p.name), ["Plan 1"]);
});

// --- Never skipping a Legend Rare ---------------------------------------------------

const PLATINUM = "2026-10-16_1071";
const LEGEND_CAPSULE = "2026-10-16_1072";
const NORMAL = "2026-10-20_1070";
const tablesFor = (ids, count) => ingest(dataset, "139026851", count, { eventIds: ids, today: TODAY }).banners;

// The Legend Rare spots a path skips: pulled without a Legend Rare, or taken
// by a guaranteed 11-draw's uber (walked like verifySolution).
function skippedSpots(banners, sol, spots) {
  let pos = "1A";
  let last = null;
  const out = [];
  for (const act of sol.actions) {
    const rolls = banners[act.banner_index].rolls;
    const pulls = act.action_type === pf.ACTION_GUARANTEED_11 ? 10 : act.action_type === pf.ACTION_MULTI_11 ? 11 : 1;
    for (let k = 0; k < pulls; k++) {
      const [unit, next] = pf.getNextPosNormal(pos, null, rolls, last);
      if (spots.at.has(pos) && !spots.keep(unit)) out.push(pos);
      [pos, last] = [next, unit];
    }
    if (act.action_type === pf.ACTION_GUARANTEED_11) {
      if (spots.at.has(pos)) out.push(pos);
      [pos, last] = [act.position_to, act.units_pulled.at(-1)];
    }
  }
  return out;
}

test("Legend Rare spots: the searched banners', but not the Legend Capsule's", () => {
  const isLR = (u) => dataset.rarityOf(u) === LEGEND;
  const normal = legendRareSpots(dataset, tablesFor([NORMAL], 400));
  assert.ok(normal.at.size > 0);
  assert.ok([...normal.at].every((pos) => isLR(tablesFor([NORMAL], 400)[0].rolls[pos].unit)));
  // The Capsule has plenty, but they don't count; the Platinum Capsule has none.
  const capsule = tablesFor([LEGEND_CAPSULE], 400)[0];
  assert.ok(Object.values(capsule.rolls).filter((c) => isLR(c.unit)).length > normal.at.size);
  assert.equal(legendRareSpots(dataset, [capsule]).at.size, 0);
  assert.equal(legendRareSpots(dataset, tablesFor([PLATINUM], 400)).at.size, 0);
  // Any Legend Rare there counts as getting it, the Capsule's too.
  assert.ok(normal.keep(Object.values(capsule.rolls).find((c) => isLR(c.unit)).unit));
});

test("never skipping a Legend Rare", () => {
  // Mamoluga is cheapest from the Platinum Capsule at 342B, where the other
  // banner has a Legend Rare; with the option, the path gets it further on.
  const ids = [PLATINUM, NORMAL];
  const body = { seed: "139026851", event_ids: ids, count: 400, resources: { rare_tickets: 420, platinum_tickets: 1 }, owned: [], wish: wishOf(["Mamoluga"]) };
  const banners = tablesFor(ids, 400);
  const spots = legendRareSpots(dataset, banners);
  const free = searchRequest(dataset, master, body, { today: TODAY });
  assert.deepEqual(skippedSpots(banners, free.solutions[0], spots), ["342B"]);
  assert.equal(free.keep_legends, false);
  const kept = searchRequest(dataset, master, { ...body, keep_legends: true }, { today: TODAY });
  assert.equal(kept.keep_legends, true);
  assert.ok(kept.solutions.length > 0);
  for (const s of kept.solutions) {
    assert.deepEqual(skippedSpots(banners, s, spots), []);
    assert.ok(s.verified);
  }
  assert.deepEqual(kept.solutions[0].collected_units, ["Mamoluga"]);
  assert.equal(kept.solutions[0].cost.rare_tickets, 353);
  assert.equal(free.solutions[0].cost.rare_tickets, 339);
});

// --- Wishlist codes and changes ------------------------------------------------------

const uids = new Set(master.units.map((u) => u.uid));
const listA = { name: "Ubers 🐱 first", ranking: "most", units: [{ uid: 824, on: true }, { uid: 32, on: false }, { uid: 769, on: true }] };

test("all the wishlists come back from their code", () => {
  const w = { lists: [wl.newList(), listA], open: 1, every: true, keepLegends: true };
  assert.deepEqual(wl.decodeWishes(wl.encodeWishes(w), uids), w);
  assert.deepEqual(wl.decodeWishes(wl.encodeWishes({ ...w, every: false }), uids), { ...w, every: false });
  // Nothing but an empty list is no code at all, and a broken code is empty.
  assert.equal(wl.encodeWishes(wl.emptyWishes()), "");
  assert.deepEqual(wl.decodeWishes("", uids), wl.emptyWishes());
  assert.deepEqual(wl.decodeWishes("@@@", uids), wl.emptyWishes());
  // Units the Cat Guide list doesn't know are left out.
  const back = wl.decodeWishes(wl.encodeWishes({ ...w, lists: [listA] , open: 0 }), new Set([824]));
  assert.deepEqual(back.lists[0].units, [{ uid: 824, on: true }]);
});

test("one wishlist travels alone, as a code or a link", () => {
  const code = wl.encodeList(listA);
  assert.deepEqual(wl.decodeList(code, uids), listA);
  assert.deepEqual(wl.decodeList(`https://example.test/#wish=${code}`, uids), listA);
  assert.equal(wl.decodeList(wl.encodeWishes({ lists: [listA], open: 0, every: false }), uids), null);
  assert.equal(wl.decodeList("nope", uids), null);
});

test("a shared wishlist is added as an exact copy, once", () => {
  const mine = { lists: [{ ...wl.newList(), units: [{ uid: 5, on: true }] }], open: 0, every: true };
  const first = wl.importList(mine, listA);
  assert.equal(first.added, true);
  assert.deepEqual(first.wishes.lists, [mine.lists[0], listA]);
  assert.equal(first.wishes.open, 1);
  assert.equal(first.wishes.every, false);
  const again = wl.importList({ ...first.wishes, open: 0 }, listA);
  assert.equal(again.added, false);
  assert.equal(again.wishes.lists.length, 2);
  assert.equal(again.wishes.open, 1);
  // A name that's taken gets a number; the same units and ranking under any
  // name are already there.
  const named = wl.importList(again.wishes, { ...listA, name: wl.DEFAULT_NAME, ranking: "order" });
  assert.equal(named.name, `${wl.DEFAULT_NAME} (2)`);
  assert.deepEqual(named.wishes.lists[2], { ...listA, name: `${wl.DEFAULT_NAME} (2)`, ranking: "order" });
  assert.equal(wl.importList(named.wishes, { ...listA, name: "Anything" }).added, false);
  // With nothing but the empty starting list, the copy takes its place.
  assert.deepEqual(wl.importList(wl.emptyWishes(), listA).wishes, { lists: [listA], open: 0, every: false, keepLegends: false });
});

test("changing a wishlist", () => {
  let list = wl.newList(" ");
  assert.equal(list.name, wl.DEFAULT_NAME);
  for (const uid of [1, 2, 3, 2]) list = wl.withUnit(list, uid);
  assert.deepEqual(list.units.map((u) => u.uid), [1, 2, 3]);
  assert.deepEqual(wl.moved(list, 2, 0).units.map((u) => u.uid), [3, 1, 2]);
  assert.deepEqual(wl.moved(list, 0, 9).units.map((u) => u.uid), [2, 3, 1]);
  assert.deepEqual(wl.withTick(list, 2, false).units.map((u) => u.on), [true, false, true]);
  assert.ok(wl.withAllTicked(wl.withAllTicked(list, false), true).units.every((u) => u.on));
  assert.deepEqual(wl.withoutUnit(list, 1).units.map((u) => u.uid), [2, 3]);
  const w = { lists: [list, wl.withUnit(wl.newList("B"), 3)], open: 1, every: false };
  assert.deepEqual(wl.listsWith(w, [3, 9]), [{ index: 0, name: wl.DEFAULT_NAME, uids: [3] }, { index: 1, name: "B", uids: [3] }]);
  assert.deepEqual(wl.removeEverywhere(w, [3]).lists.map((l) => l.units.length), [2, 0]);
  assert.equal(wl.deleteList(w, 0).open, 0);
  assert.equal(wl.deleteList(w, 0).lists[0].name, "B");
  assert.deepEqual(wl.deleteList(wl.deleteList(w, 0), 0), wl.emptyWishes());
});
