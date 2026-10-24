// The path search's rules (src/engine/pathfinder.js) on small hand-made
// tables and on godfat's saved ones. Every returned solution must re-simulate
// (verifySolution) cleanly against the tables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as pf from "../src/engine/pathfinder.js";
import { parseTables } from "./helpers/godfat-html.mjs";

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sample_banners.txt");
const sampleTables = () => parseTables(readFileSync(SAMPLE, "utf8"));
const sampleBanners = () => sampleTables().map((rolls, i) => new pf.Banner(`B${i + 1}`, rolls));

const assertVerifies = (banners, sol) => {
  const [ok, errors] = pf.verifySolution(banners, sol);
  assert.ok(ok, errors.join("; "));
};

// A banner where pulling at row i gives units[i] and moves to row i+1.
function linearBanner(units, { name = "B", type = pf.BANNER_NORMAL, guaranteed = null } = {}) {
  const rolls = {};
  units.forEach((u, i) => {
    rolls[`${i + 1}A`] = { unit: u };
  });
  if (guaranteed) {
    const [pos, unit, next] = guaranteed;
    rolls[pos] = { ...rolls[pos], guaranteed_unit: unit, guaranteed_next: next };
  }
  return new pf.Banner(name, rolls, type);
}

// --- Reading godfat's tables and single pulls -------------------------------

test("godfat's saved tables are read with their seeds", () => {
  const tables = sampleTables();
  assert.equal(tables.length, 5);
  assert.equal(tables[0]["1A"].unit, "Vaulter Cat");
  assert.equal(tables[0]["1A"].guaranteed_unit, "Mass Production EVA");
  assert.equal(tables[0]["1A"].guaranteed_next, "12A");
  // godfat puts the seed *after* a pull in the cat's name link.
  assert.equal(tables[0]["1A"].unit_seed, "4060011645");
  assert.equal(tables[0]["1A"].guaranteed_seed, "2609696845");
});

test("a single pull moves down its track", () => {
  const rolls = { "1A": { unit: "A" }, "2A": { unit: "B" } };
  assert.deepEqual(pf.getNextPosNormal("1A", "A", rolls, null).slice(0, 3), ["A", "2A", "Normal"]);
});

test("a dupe takes the cell's dupe line and jumps", () => {
  const rolls = { "1A": { unit: "Dup", alt_unit: "AltUnit", alt_next: "9B" } };
  assert.deepEqual(pf.getNextPosNormal("1A", "Dup", rolls, "Dup").slice(0, 3), ["AltUnit", "9B", "Duplicate"]);
});

// --- Costs --------------------------------------------------------------------

test("single pulls are paid with rare tickets when there are some", () => {
  const banner = linearBanner(["A", "Target", "C"]);
  const sols = pf.findPaths([banner], ["Target"], { resources: { rare_tickets: 10 }, maxSteps: 10000, maxSolutions: 5 });
  const best = sols[0];
  assert.deepEqual(best.collected_units, ["Target"]);
  // Two single pulls reach 2A; the cheapest pays both with rare tickets.
  assert.equal(best.cost.rare_tickets, 2);
  assert.equal(best.cost.cat_food, 0);
  assertVerifies([banner], best);
});

test("a cat-food single pull costs 150", () => {
  const sols = pf.findPaths([linearBanner(["Target"])], ["Target"], { resources: { cat_food: 1000 }, maxSteps: 10000 });
  assert.equal(sols[0].cost.cat_food, pf.CAT_FOOD_PER_PULL);
  assert.equal(sols[0].cost.rare_tickets, 0);
});

test("tickets are spent first, then cat food", () => {
  // "e" needs 5 single pulls; only 2 rare tickets.
  const banner = linearBanner(["a", "b", "c", "d", "e"]);
  const best = pf.findPaths([banner], ["e"], {
    resources: { rare_tickets: 2, cat_food: 10000 }, maxSteps: 20000, maxSolutions: 3,
  })[0];
  assert.equal(best.cost.rare_tickets, 2);
  assert.equal(best.cost.cat_food, 3 * pf.CAT_FOOD_PER_PULL);
  assert.deepEqual(best.actions.map((a) => a.payment), [
    pf.PAY_RARE_TICKET, pf.PAY_RARE_TICKET, pf.PAY_CAT_FOOD, pf.PAY_CAT_FOOD, pf.PAY_CAT_FOOD]);
  assertVerifies([banner], best);
});

test("no cat-food single pull while tickets remain", () => {
  const sols = pf.findPaths([linearBanner(["Target"])], ["Target"], {
    resources: { rare_tickets: 5, cat_food: 10000 }, maxSteps: 10000,
  });
  assert.deepEqual(sols[0].cost, { rare_tickets: 1, cat_food: 0, platinum_tickets: 0, legend_tickets: 0 });
});

test("a plain 11-roll on a non-guaranteed banner: 11 pulls for 1500", () => {
  // The target is the 11th cat; with no tickets, 11 singles cost 1650.
  const banner = linearBanner(Array.from({ length: 15 }, (_, i) => `u${i}`));
  const best = pf.findPaths([banner], ["u10"], {
    resources: { rare_tickets: 0, cat_food: 1700 }, maxSteps: 50000, maxSolutions: 5,
  })[0];
  const draw = best.actions[0];
  assert.equal(draw.action_type, pf.ACTION_MULTI_11);
  assert.deepEqual(draw.units_pulled, Array.from({ length: 11 }, (_, i) => `u${i}`));
  assert.equal(draw.position_to, "12A"); // 1A + 11 pulls
  assert.equal(best.cost.cat_food, pf.CAT_FOOD_PER_11_DRAW);
  assert.equal(best.cost.rare_tickets, 0);
  assertVerifies([banner], best);
});

test("a guaranteed 11-draw costs 1500 and ends in the uber", () => {
  const banner = linearBanner(Array.from({ length: 20 }, (_, i) => `u${i}`), { guaranteed: ["1A", "GuaranteedTarget", "12A"] });
  const best = pf.findPaths([banner], ["GuaranteedTarget"], {
    resources: { cat_food: 2000, rare_tickets: 0 }, maxSteps: 10000,
  })[0];
  assert.equal(best.actions[0].action_type, pf.ACTION_GUARANTEED_11);
  assert.equal(best.actions[0].units_pulled.length, 11);
  assert.equal(best.cost.cat_food, pf.CAT_FOOD_PER_11_DRAW);
  assertVerifies([banner], best);
});

test("resource limits are never exceeded", () => {
  const units = Array.from({ length: 10 }, (_, i) => `u${i}`);
  const caps = { rare_tickets: 3, cat_food: 300 };
  for (const s of pf.findPaths([linearBanner(units)], units, { resources: caps, maxSteps: 50000, maxSolutions: 20 })) {
    assert.ok(s.cost.rare_tickets <= caps.rare_tickets && s.cost.cat_food <= caps.cat_food);
  }
});

test("a path ends at its last target, with no pulls after it", () => {
  // Only "Target" is reachable, so the search keeps exploring past it; the
  // path returned must still stop there.
  const banner = linearBanner(["a", "Target", "c", "d", "e", "f", "g"]);
  const sols = pf.findPaths([banner], ["Target", "NeverInBanner"], {
    resources: { rare_tickets: 10 }, maxSteps: 20000, maxSolutions: 10,
  });
  const best = sols[0];
  assert.deepEqual(best.collected_units, ["Target"]);
  assert.deepEqual(best.actions.at(-1).targets_hit, ["Target"]);
  assert.equal(best.actions.length, 2);
  assert.equal(best.cost.rare_tickets, 2);
  assert.equal(best.final_position, "3A");
  for (const s of sols) {
    assert.ok(s.actions.at(-1).targets_hit.length, "no path ends on a pull without a target");
    assertVerifies([banner], s);
  }
});

// --- Platinum / Legend Capsules -----------------------------------------------

test("a Platinum Capsule uses platinum tickets only, single pulls", () => {
  const plat = linearBanner(["PlatA", "PlatTarget", "PlatC"], { name: "Platinum", type: pf.BANNER_PLATINUM });
  const best = pf.findPaths([plat], ["PlatTarget"], {
    resources: { platinum_tickets: 5, rare_tickets: 99, cat_food: 99999 }, maxSteps: 10000,
  })[0];
  assert.equal(best.cost.platinum_tickets, 2);
  assert.equal(best.cost.rare_tickets, 0);
  assert.equal(best.cost.cat_food, 0);
  assert.ok(best.actions.every((a) => a.action_type === pf.ACTION_PLATINUM));
  assertVerifies([plat], best);
});

test("a Platinum Capsule is left out without platinum tickets", () => {
  const plat = linearBanner(["PlatA", "PlatTarget"], { name: "Platinum", type: pf.BANNER_PLATINUM });
  assert.deepEqual(pf.findPaths([plat], ["PlatTarget"], { resources: { platinum_tickets: 0, cat_food: 99999 }, maxSteps: 10000 }), []);
});

test("a Legend Capsule uses legend tickets only", () => {
  const legend = linearBanner(["LegA", "LegTarget"], { name: "Legend", type: pf.BANNER_LEGEND });
  const best = pf.findPaths([legend], ["LegTarget"], { resources: { legend_tickets: 3, rare_tickets: 99 }, maxSteps: 10000 })[0];
  assert.equal(best.cost.legend_tickets, 2);
  assert.equal(best.cost.rare_tickets, 0);
  assert.ok(best.actions.every((a) => a.action_type === pf.ACTION_LEGEND));
});

test("with normal and capsule banners, every path still checks out", () => {
  const normal = linearBanner(["x", "Shared"], { name: "Normal" });
  const legend = linearBanner(["Shared"], { name: "Legend", type: pf.BANNER_LEGEND });
  const sols = pf.findPaths([normal, legend], ["Shared"], {
    resources: { rare_tickets: 99, legend_tickets: 1 }, maxSteps: 10000, maxSolutions: 10,
  });
  assert.deepEqual(sols[0].collected_units, ["Shared"]);
  for (const s of sols) assertVerifies([normal, legend], s);
});

test("strict mode returns only complete solutions", () => {
  const banner = linearBanner(["A", "B", "C"]);
  const sols = pf.findPaths([banner], ["A", "B", "C"], { resources: { rare_tickets: 99 }, mode: pf.MODE_STRICT, maxSteps: 10000, maxSolutions: 3 });
  assert.ok(sols.length);
  for (const s of sols) {
    assert.equal(s.collected_count, 3);
    assertVerifies([banner], s);
  }
});

// --- On godfat's saved tables ---------------------------------------------------

const TARGETS = ["Mass Production EVA", "The 9th Angel"];
const searchSample = (maxSolutions) => {
  const banners = sampleBanners();
  const sols = pf.findPaths(banners, TARGETS, {
    resources: { rare_tickets: 30, cat_food: 3000 }, maxSteps: 200000, maxSolutions,
  });
  return [banners, sols];
};

test("every solution on godfat's tables verifies and respects the caps", () => {
  const [banners, sols] = searchSample(10);
  assert.ok(sols.length);
  for (const s of sols) {
    assertVerifies(banners, s);
    assert.ok(s.cost.rare_tickets <= 30 && s.cost.cat_food <= 3000);
  }
});

test("a solution carries the seed after its last pull", () => {
  const [, sols] = searchSample(5);
  for (const s of sols) {
    assert.equal(s.final_seed, s.actions.at(-1).result_seed);
    assert.match(s.final_seed, /^\d+$/);
  }
});

// --- Track-table cells ------------------------------------------------------------

test("each action's cells give exactly the units it pulled", () => {
  // 1 cell for a single pull, 11 for an 11-draw (ten normal pulls + the
  // guaranteed column of its start row).
  const [banners, sols] = searchSample(10);
  const key = { [pf.CELL_UNIT]: "unit", [pf.CELL_ALT]: "alt_unit", [pf.CELL_GUARANTEED]: "guaranteed_unit",
    [pf.CELL_ALT_GUARANTEED]: "alt_guaranteed_unit" };
  const seen = new Set();
  for (const s of sols) {
    const cellsPerAction = pf.solutionCells(banners, s);
    assert.equal(cellsPerAction.length, s.actions.length);
    s.actions.forEach((act, i) => {
      const cells = cellsPerAction[i];
      const rolls = banners[act.banner_index].rolls;
      assert.deepEqual(cells.map((c) => rolls[c.pos][key[c.result]]), act.units_pulled);
      assert.equal(cells[0].pos, act.position_from);
      const expected = act.action_type === pf.ACTION_GUARANTEED_11 || act.action_type === pf.ACTION_MULTI_11 ? 11 : 1;
      assert.equal(cells.length, expected);
      seen.add(act.action_type);
      if (act.action_type === pf.ACTION_GUARANTEED_11) {
        assert.equal(cells.at(-1).pos, act.position_from);
        assert.ok([pf.CELL_GUARANTEED, pf.CELL_ALT_GUARANTEED].includes(cells.at(-1).result));
      }
    });
  }
  assert.ok(seen.has(pf.ACTION_GUARANTEED_11) && seen.has(pf.ACTION_SINGLE));
});

test("a dupe pull shows as the cell's dupe line", () => {
  // 1A gives "Dup", then 2A is a dupe: its dupe line, then a jump to 5B.
  const rolls = { "1A": { unit: "Dup" }, "2A": { unit: "Dup", alt_unit: "Alt", alt_next: "5B" }, "5B": { unit: "Target" } };
  const banner = new pf.Banner("B", rolls);
  const sols = pf.findPaths([banner], ["Target"], { resources: { rare_tickets: 5 } });
  assert.deepEqual(pf.solutionCells([banner], sols[0]).flat(), [
    { pos: "1A", result: "unit" }, { pos: "2A", result: "alt" }, { pos: "5B", result: "unit" }]);
});

test("an 11-draw whose first pull is a dupe takes the dupe line's uber", () => {
  // Pull 1A gives "Dup"; an 11-draw from 2A starts with a dupe, so godfat's
  // chain runs from 2A's reroll and the uber is 2A's RG cell.
  const rolls = {
    "1A": { unit: "Dup" },
    "2A": { unit: "Dup", alt_unit: "Alt", alt_next: "3B", guaranteed_unit: "WrongUber", guaranteed_next: "13A",
      alt_guaranteed_unit: "RightUber", alt_guaranteed_next: "14B", alt_guaranteed_seed: "777" },
  };
  for (let n = 3; n < 16; n++) for (const t of "AB") rolls[`${n}${t}`] = { unit: `u${n}${t}` };
  const banner = new pf.Banner("B", rolls);
  const best = pf.findPaths([banner], ["RightUber", "WrongUber"], { resources: { rare_tickets: 1, cat_food: 1500 } })[0];
  const i = best.actions.findIndex((a) => a.action_type === pf.ACTION_GUARANTEED_11);
  const draw = best.actions[i];
  assert.equal(draw.position_from, "2A");
  assert.equal(draw.units_pulled.at(-1), "RightUber");
  assert.equal(draw.position_to, "14B");
  assert.equal(draw.result_seed, "777");
  assertVerifies([banner], best);
  const cells = pf.solutionCells([banner], best)[i];
  assert.deepEqual(cells[0], { pos: "2A", result: "alt" });
  assert.deepEqual(cells.at(-1), { pos: "2A", result: "alt_guaranteed" });
});

test("a guaranteed banner never plans a plain 11-roll", () => {
  // Past its last guaranteed cell (the draw would run off the table), a
  // guaranteed banner can't do a plain 11-roll instead.
  const rolls = {};
  for (let i = 1; i < 30; i++) rolls[`${i}A`] = { unit: `u${i}` };
  Object.assign(rolls["1A"], { guaranteed_unit: "G", guaranteed_next: "12A" });
  const banner = new pf.Banner("B", rolls);
  assert.ok(banner.hasGuaranteed);
  const sols = pf.findPaths([banner], ["u20"], { resources: { cat_food: 3000 } });
  assert.ok(!sols.some((s) => s.actions.some((a) => a.action_type === pf.ACTION_MULTI_11)));
});
