// "Explain the path" (src/explain.js): a short reason for each step, on small
// hand-made tables.
import { test } from "node:test";
import assert from "node:assert/strict";

import * as pf from "../src/engine/pathfinder.js";
import { explainPath } from "../src/explain.js";

// A path as the page gets it: with its cells and dupes.
function bestPath(banners, targets, opts) {
  const [sol] = pf.findPaths(banners, targets, opts);
  return { ...sol, cells: pf.solutionCells(banners, sol), dupes: pf.solutionDupes(banners, sol) };
}

const linear = (name, units, extra = {}) =>
  new pf.Banner(name, Object.fromEntries(units.map((u, i) => [`${i + 1}A`, { unit: u, ...(extra[i] || {}) }])));

test("steps that only move you on share one line, toward the next target", () => {
  const b = linear("B", ["a", "b", "c", "d", "T", "e", "U"]);
  const sol = bestPath([b], ["T", "U"], { resources: { rare_tickets: 7 } });
  const why = explainPath(sol, { ranks: { T: 1 } });
  assert.deepEqual(why, [
    ["⬇ Steps 1–4 move you down to 5A, toward #1 T at 5A"], null, null, null,
    ["🎯 For #1 T"],
    ["⬇ Moves you down to 7A, toward U at 7A"],
    ["🎯 For U"],
  ]);
});

test("a switch: the step that sets it up, and where it leads", () => {
  // R on B1, then B2's 2A is R again: rerolled to Q, you switch to 3B, for T.
  const b1 = new pf.Banner("B1", { "1A": { unit: "R" }, "2A": { unit: "y" } });
  const b2 = new pf.Banner("B2", {
    "1A": { unit: "z" }, "2A": { unit: "R", reroll_unit: "Q", reroll_next: "3B" }, "3B": { unit: "T" }, "4B": { unit: "w" },
  });
  const why = explainPath(bestPath([b1, b2], ["T"], { resources: { rare_tickets: 3 } }));
  assert.deepEqual(why, [
    ["↪ Sets up a switch: your next pull is R again, rerolled to Q, and you switch to track B (3B)"],
    ["🔀 Its switch to track B (3B) leads to T at 3B"],
    ["🎯 For T"],
  ]);
});

test("Legend Rares on the way, or pulled so they aren't skipped; a guaranteed uber", () => {
  const units = { L: { rarity: "Legend Rare" } };
  const g = linear("G", ["a", "L", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"], {
    0: { guaranteed_unit: "Uber", guaranteed_next: "12B" },
  });
  const sol = bestPath([g], ["Uber"], { resources: { cat_food: 1500 } });
  assert.equal(sol.actions[0].action_type, pf.ACTION_GUARANTEED_11);
  assert.deepEqual(explainPath(sol, { units }), [["🎯 For Uber (its guaranteed uber)", "✨ Gets L on the way"]]);
  assert.deepEqual(explainPath(sol, { units, keepLegends: true })[0][1], "✨ Pulls L here, so it isn't skipped");
});

test("a switch inside an 11-draw, and one that's on the way to another", () => {
  // Pull 3 of a plain 11-roll dupes c (pulled 2nd) and jumps to 4B; pull 4
  // there dupes again, back to track A.
  const rolls = {};
  ["a", "c", "c"].forEach((u, i) => (rolls[`${i + 1}A`] = { unit: u }));
  Object.assign(rolls["3A"], { reroll_unit: "x", reroll_next: "4B" });
  rolls["4B"] = { unit: "x", reroll_unit: "y", reroll_next: "6A" };
  for (let n = 6; n <= 12; n++) rolls[`${n}A`] = { unit: n === 12 ? "T" : `u${n}` };
  const b = new pf.Banner("B", rolls);
  const sol = bestPath([b], ["T"], { resources: { cat_food: 1500 } });
  assert.equal(sol.actions.length, 1);
  assert.deepEqual(explainPath(sol), [[
    "🎯 For T",
    "🔀 Pull 3's switch to track B (4B) is on the way: you switch again at 4B",
    "🔀 Pull 4's switch to track A (6A) leads to T at 12A",
  ]]);
});
