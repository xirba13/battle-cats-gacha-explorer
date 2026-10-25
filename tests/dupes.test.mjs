// Dupes and the track switches they cause: a Rare equal to the cat pulled
// just before (on any banner, or before the path) is rerolled, and you jump,
// usually to the other track. On small hand-made tables, then on the data
// recorded in tests/fixtures/golden.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Dataset, ingest } from "../src/engine/data.js";
import * as pf from "../src/engine/pathfinder.js";
import { MasterData, followedRequest, planOf, planRequest, searchRequest } from "../src/engine/services.js";
import { decodePlan, encodePlan } from "../src/plancode.js";

const steps = (sol) => sol.actions.map((a) => `${a.banner_index}:${a.position_from}>${a.position_to}:${a.units_pulled.join("+")}`);

// --- On hand-made tables ----------------------------------------------------------

test("a Rare equal to the last cat is rerolled, whichever banner it came from", () => {
  // B2's 2A has no dupe line of its own (its 1A is another cat), but after R
  // from B1 it dupes: you get its reroll and jump to 3B, where T is.
  const b1 = new pf.Banner("B1", { "1A": { unit: "R" }, "2A": { unit: "y" } });
  const b2 = new pf.Banner("B2", {
    "1A": { unit: "z" }, "2A": { unit: "R", reroll_unit: "Q", reroll_next: "3B" }, "3B": { unit: "T" }, "4B": { unit: "w" },
  });
  const [sol] = pf.findPaths([b1, b2], ["T"], { resources: { rare_tickets: 3 } });
  assert.deepEqual(steps(sol), ["0:1A>2A:R", "1:2A>3B:Q", "1:3B>4B:T"]);
  assert.ok(pf.verifySolution([b1, b2], sol)[0]);
  assert.deepEqual(pf.solutionDupes([b1, b2], sol), [{ action: 1, pull: 1, pos: "2A", was: "R", got: "Q", next: "3B" }]);
  assert.deepEqual(pf.solutionCells([b1, b2], sol)[1], [{ pos: "2A", result: pf.CELL_ALT }]);
});

test("the cat pulled before the path can make its first pull a dupe", () => {
  // After R, 1A is rerolled to Q and you land on 2B (U), not 2A (T).
  const b = new pf.Banner("B", { "1A": { unit: "R", reroll_unit: "Q", reroll_next: "2B" }, "2A": { unit: "T" }, "2B": { unit: "U" } });
  const opts = { resources: { rare_tickets: 2 } };
  assert.deepEqual(pf.findPaths([b], ["T"], opts)[0].collected_units, ["T"]);
  assert.deepEqual(pf.findPaths([b], ["T"], { ...opts, last: "R" }), []);
  const [sol] = pf.findPaths([b], ["U"], { ...opts, last: "R" });
  assert.deepEqual(steps(sol), ["0:1A>2B:Q", "0:2B>3B:U"]);
  assert.ok(pf.verifySolution([b], sol, { last: "R" })[0]);
  assert.equal(pf.verifySolution([b], sol)[0], false);
  assert.deepEqual(pf.solutionDupes([b], sol, { last: "R" }), [{ action: 0, pull: 1, pos: "1A", was: "R", got: "Q", next: "2B" }]);
});

test("an 11-draw whose first pull dupes another banner's cat takes its uber from the reroll's chain", () => {
  // From 2A the draw's ten pulls end on 12A (its uber G1); after R from B1,
  // its first pull dupes and the chain runs down track B to 12B (uber G2).
  const rolls = { "2A": { unit: "R", reroll_unit: "Q", reroll_next: "3B", guaranteed_unit: "G1", guaranteed_next: "12B" } };
  for (let n = 3; n <= 12; n++) {
    rolls[`${n}A`] = { unit: `a${n}` };
    rolls[`${n}B`] = { unit: `b${n}` };
  }
  Object.assign(rolls["12A"], { uber11_unit: "G1", uber11_next: "12B", uber11_seed: "1" });
  Object.assign(rolls["12B"], { uber11_unit: "G2", uber11_next: "13A", uber11_seed: "2" });
  rolls["13A"] = { unit: "x" };
  const b1 = new pf.Banner("B1", { "1A": { unit: "R" }, "2A": { unit: "y" } });
  const b2 = new pf.Banner("B2", rolls);
  const [sol] = pf.findPaths([b1, b2], ["G2"], { resources: { rare_tickets: 1, cat_food: 1500 } });
  assert.deepEqual(sol.actions.map((a) => a.action_type), [pf.ACTION_SINGLE, pf.ACTION_GUARANTEED_11]);
  assert.deepEqual(sol.actions[1].units_pulled, ["Q", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10", "b11", "G2"]);
  assert.equal(sol.final_position, "13A");
  assert.ok(pf.verifySolution([b1, b2], sol)[0]);
  assert.deepEqual(pf.solutionCells([b1, b2], sol)[1].at(-1), { pos: "2A", result: pf.CELL_ALT_GUARANTEED });
});

test("the pull after a path: on which banners it would dupe", () => {
  const b1 = new pf.Banner("B1", { "1A": { unit: "R" }, "2A": { unit: "R", reroll_unit: "Q", reroll_next: "3B" } });
  const b2 = new pf.Banner("B2", { "1A": { unit: "z" }, "2A": { unit: "w" } });
  const [sol] = pf.findPaths([b1, b2], ["R"], { resources: { rare_tickets: 1 } });
  assert.equal(sol.final_position, "2A");
  assert.deepEqual(pf.nextDupes([b1, b2], sol), [{ banner_index: 0, got: "Q", next: "3B" }]);
});

// --- On the recorded data ----------------------------------------------------------

const golden = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "golden.json"), "utf8"));
const search = golden.searches.find((s) => s.title === "dupe paths");
const dataset = new Dataset(golden.datasets[search.data]);
const master = new MasterData(golden.master);
const banners = ingest(dataset, search.body.seed, search.body.count, { eventIds: search.body.event_ids, today: search.today }).banners;

test("a dupe after another banner's cat, where godfat's table shows none", () => {
  // Stilts Cat on the second banner at 7A, then the first banner's 8A: also
  // Stilts Cat, with no dupe line there (its own 7A is Shaman Cat). It's
  // rerolled to Archer Cat, and you jump to 9B.
  assert.equal(banners[1].rolls["7A"].unit, "Stilts Cat");
  assert.equal(banners[0].rolls["8A"].unit, "Stilts Cat");
  assert.ok(!("alt_unit" in banners[0].rolls["8A"]));
  const actions = pf.replaySteps(banners, [0, 0, 0, 0, 0, 0, 2, 0]);
  assert.deepEqual(steps({ actions }).slice(-2), ["1:7A>8A:Stilts Cat", "0:8A>9B:Archer Cat"]);
  assert.deepEqual(pf.solutionDupes(banners, { actions }), [{ action: 7, pull: 1, pos: "8A", was: "Stilts Cat", got: "Archer Cat", next: "9B" }]);
});

test("no path pulls a Rare twice in a row without its reroll", () => {
  const isRare = (u) => dataset.rarityOf(u) === 2;
  for (const s of golden.searches.filter((x) => x.data === search.data)) {
    const result = searchRequest(dataset, master, s.body, { today: s.today, maxSteps: s.max_steps });
    for (const sol of result.solutions) {
      // Everything pulled, in order (a guaranteed draw's uber is the last cat
      // after it).
      const pulled = sol.actions.flatMap((a) => a.units_pulled);
      pulled.forEach((u, i) => assert.ok(i === 0 || !(isRare(u) && u === pulled[i - 1]), `${s.title}: ${u} twice`));
      assert.ok(sol.verified);
    }
  }
});

test("the last cat before a search, after a followed path, and in a plan", () => {
  // With this seed, the banner's 1A is Mer-Cat, a Rare. With Mer-Cat as the
  // last cat before, the first pull there dupes.
  const uidOf = (name) => master.units.find((u) => u.name === name)?.uid;
  const [eventId, seed] = ["2025-04-28_946", "1234567"];
  const first = dataset.banner(Number(seed), eventId, 5).rolls["1A"];
  assert.equal(first.unit, "Mer-Cat");
  const uid = uidOf(first.unit);
  const body = { ...search.body, seed, event_ids: [eventId], last: uid, max_solutions: 3 };
  const result = searchRequest(dataset, master, body, { today: search.today });
  assert.equal(result.last, uid);
  const sol = result.solutions[0];
  assert.equal(sol.actions[0].units_pulled[0], first.reroll_unit);
  assert.deepEqual(sol.dupes[0], { action: 0, pull: 1, pos: "1A", was: first.unit, got: first.reroll_unit, next: first.reroll_next });
  // A plan keeps it, through its code.
  const plan = decodePlan(encodePlan({ ...planOf(result, sol), savedOn: "2026-10-25" }));
  assert.equal(plan.last, uid);
  const back = planRequest(dataset, master, plan);
  assert.equal(back.problem, null);
  assert.deepEqual(back.solutions[0].actions, sol.actions);
  // Following a path gives its last cat.
  const lastName = sol.actions.at(-1).units_pulled.at(-1);
  assert.equal(followedRequest(master, { solution: sol }).last_uid, master.units.find((u) => u.name === lastName)?.uid ?? null);
});
