// The roll engine (src/engine/rolls.js) against godfat's own tables.
//
// fixtures/sample_banners.txt holds five roll tables saved from bc.godfat.org
// for one seed: four guaranteed banners and a Legend Capsule.
// fixtures/godfat_fixture_data.json is godfat's data for those five events.
// Building the tables here must give every value godfat showed: each cat,
// every dupe result and where it jumps, every guaranteed uber (also the ones
// after a dupe first pull) and every seed link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Dataset, bannerType } from "../src/engine/data.js";
import * as pathfinder from "../src/engine/pathfinder.js";
import { Pool, RARE, UBER, guaranteedRollsFor, retreat } from "../src/engine/rolls.js";
import { parseTables } from "./helpers/godfat-html.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const godfatTables = parseTables(readFileSync(join(fixtures, "sample_banners.txt"), "utf8"));
const dataset = new Dataset(JSON.parse(readFileSync(join(fixtures, "godfat_fixture_data.json"), "utf8")));

// The five tables in the fixture, in order (found by matching every event in
// godfat's data against the fixture's first rows).
const FIXTURE_EVENTS = ["2025-12-09_1019", "2025-12-09_1020", "2025-04-28_946", "2025-12-12_1005", "2025-11-07_996"];
// Cats godfat has renamed since the fixture was saved (his page then, his data now).
const RENAMED = { "Amakusa Shiro": "Shiro Amakusa", Terun: "Huntress Terun" };

test("tables match godfat's, cell for cell", () => {
  // Each cat's link carries the seed after pulling it; 1A's is two steps in.
  const seed = retreat(retreat(Number(godfatTables[0]["1A"].unit_seed)));
  assert.equal(seed, 139026851);
  assert.equal(godfatTables.length, FIXTURE_EVENTS.length);

  let compared = 0;
  let dupes = 0;
  let dupeGuaranteed = 0;
  let guaranteed = 0;
  godfatTables.forEach((table, i) => {
    const eventId = FIXTURE_EVENTS[i];
    const count = Math.max(...Object.keys(table).map((pos) => parseInt(pos, 10)));
    const ours = dataset.banner(seed, eventId, count).rolls;
    assert.deepEqual(Object.keys(ours).sort(), Object.keys(table).sort(), eventId);
    for (const [pos, cell] of Object.entries(table)) {
      const mine = Object.fromEntries(Object.entries(ours[pos]).map(([k, v]) => [k, RENAMED[v] ?? v]));
      assert.deepEqual(mine, cell, `${eventId} ${pos}`);
      compared += Object.keys(cell).length;
      dupes += "alt_unit" in cell;
      guaranteed += "guaranteed_unit" in cell;
      dupeGuaranteed += "alt_guaranteed_unit" in cell;
    }
  });
  // 1,400 cells / 6,268 values, with every kind of cell in them.
  assert.equal(compared, 6268);
  assert.deepEqual([dupes, dupeGuaranteed, guaranteed], [20, 20, 1116]);
});

test("guaranteed rolls and banner types follow godfat's flags", () => {
  assert.equal(guaranteedRollsFor({ guaranteed: true }), 11);
  assert.equal(guaranteedRollsFor({ step_up: true }), 15);
  assert.equal(guaranteedRollsFor({}), 0);
  assert.equal(bannerType({ platinum: "platinum" }), pathfinder.BANNER_PLATINUM);
  assert.equal(bannerType({ platinum: "legend" }), pathfinder.BANNER_LEGEND);
  assert.equal(bannerType({ platinum: "dl-100m" }), pathfinder.BANNER_NORMAL);
  assert.equal(bannerType({}), pathfinder.BANNER_NORMAL);
});

test("a missing cat empties the pool, like godfat", () => {
  const rarity = new Map([[1, RARE], [2, UBER]]);
  assert.equal(new Pool(rarity, [1, 2, 999], 7000, 2500, 500).exists(), false);
  const pool = new Pool(rarity, [1, 2], 7000, 2500, 500);
  assert.deepEqual([pool.slots[RARE], pool.slots[UBER]], [[1], [2]]);
});
