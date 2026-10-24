// The Cat Guide list (public/data/cat_guide_master.json), name matching
// (src/engine/names.js), and choosing a search's targets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NameMatcher, normalize } from "../src/engine/names.js";
import { Banner } from "../src/engine/pathfinder.js";
import { MasterData, computeTargets, followedResult, runSearch } from "../src/engine/services.js";

const here = dirname(fileURLToPath(import.meta.url));
const masterJson = JSON.parse(readFileSync(join(here, "..", "public", "data", "cat_guide_master.json"), "utf8"));
const units = masterJson.units;
const master = new MasterData(masterJson);
const EGG_BASE = 100000;

// --- Stable uids: the URL owned-code keys on them, so shared links survive
// a unit being inserted mid-guide. A re-scrape that breaks the rule must fail
// loudly instead of corrupting everyone's saved codes.

test("every unit has a whole-number uid, all different", () => {
  assert.ok(units.every((u) => Number.isInteger(u.uid)));
  assert.equal(new Set(units.map((u) => u.uid)).size, units.length);
});

test("a unit's uid is the UniNNN of its icon", () => {
  for (const u of units) {
    if (u.uid >= EGG_BASE) continue;
    const m = /Uni(\d+)/.exec(u.icon || "");
    assert.ok(m, `${u.name} has no UniNNN icon`);
    assert.equal(u.uid, Number(m[1]), `${u.name}: uid ${u.uid} != icon ${m[1]}`);
  }
});

test("the Ancient Eggs use the reserved uid block", () => {
  // They share the Uni000_m00 placeholder icon, so they get a high block
  // instead of the (colliding) id 0, and no real id reaches it.
  const eggs = units.filter((u) => u.uid >= EGG_BASE);
  assert.ok(eggs.length && eggs.every((u) => u.name.includes("Egg")));
  assert.ok(Math.max(...units.filter((u) => u.uid < EGG_BASE).map((u) => u.uid)) < EGG_BASE);
});

// --- Name matching -------------------------------------------------------------

test("names are compared by a normalised key", () => {
  assert.equal(normalize("Li'l Cat"), "lil cat");
  assert.equal(normalize("Cat & Dog"), "cat and dog");
  assert.equal(normalize("  M. Bison  "), "m bison");
  assert.equal(normalize("Chun-Li"), "chun li");
  assert.equal(normalize("D’arc"), normalize("D'arc"));
});

test("the matcher bridges spelling differences and remembers misses", () => {
  const m = new NameMatcher([{ name: "Li'l Cat" }, { name: "Bahamut Cat" }]);
  assert.equal(m.match("Li’l Cat").name, "Li'l Cat"); // curly apostrophe
  assert.equal(m.match("bahamut cat").name, "Bahamut Cat");
  assert.equal(m.match("Nonexistent Uber"), null);
  assert.ok(m.unmatched.has("Nonexistent Uber"));
  assert.equal(master.matcher.match("Cat").name, "Cat");
  assert.ok(master.matcher.match("Bahamut Cat"));
});

// --- Targets and "I followed this path" ------------------------------------------

const linearBanner = (names) =>
  new Banner("B", Object.fromEntries(names.map((u, i) => [`${i + 1}A`, { unit: u, unit_seed: `seed${i + 1}` }])));

test("without a wishlist, owned units aren't targets", () => {
  const report = computeTargets([linearBanner(["Cat", "Tank Cat", "Axe Cat"])], master, new Set([master.indexForName("Cat")]));
  assert.ok(!report.targets.includes("Cat"));
  assert.ok(report.targets.includes("Tank Cat") && report.targets.includes("Axe Cat"));
});

test("the wishlist wins over owned", () => {
  // An owned unit on the wishlist is still a target (another copy, say); the
  // wishlist's other units are targets too, and nothing else is.
  const owned = new Set([master.indexForName("Cat"), master.indexForName("Axe Cat")]);
  const report = computeTargets([linearBanner(["Cat", "Tank Cat", "Axe Cat"])], master, owned, ["cat", "Tank Cat"]);
  assert.deepEqual(report.targets, ["Cat", "Tank Cat"]);
  assert.deepEqual(report.owned_in_banners, ["Axe Cat"]);
});

test('"I followed this path" folds the pulls into what you own', () => {
  const banner = linearBanner(["Cat", "Tank Cat"]);
  const sol = runSearch([banner], master, new Set(), { rare_tickets: 10 }, { maxSolutions: 1 }).solutions[0];
  assert.ok(sol.verified && sol.final_seed);
  const cat = master.indexForName("Cat");
  const res = followedResult(master, sol, [cat], { rare_tickets: 10 });
  assert.ok(res.owned.includes(cat));
  assert.equal(res.units_added_count, res.units_pulled_count - 1); // Cat was already owned
  assert.equal(res.new_seed, sol.final_seed);
  assert.equal(res.resources.rare_tickets, 10 - sol.cost.rare_tickets);
});
