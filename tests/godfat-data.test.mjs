// godfat's data: cutting it down from his bc-en.yaml (scripts/godfat-data.mjs,
// what the daily data job runs), and what the site does with it
// (src/engine/data.js): the Upcoming list, banners and their tables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Dataset, ingest } from "../src/engine/data.js";
import * as pathfinder from "../src/engine/pathfinder.js";
import { SOURCE_URL, dumps, extract } from "../scripts/godfat-data.mjs";

const TODAY = "2026-10-23";

// godfat's bc-en.yaml format, cut down to a few entries.
const MINI_YAML = `\
cats:
  1:
    name: [Cat, Macho Cat, Mohawk Cat]
    desc: [A cat., A macho cat., A mohawk cat.]
    stat: [{health: 100, knockbacks: 3}]
    rarity: 0
  31:
    name: [Bodhisattva Cat]
    rarity: 3
  38:
    name: [Pogo Cat, Pogo Cat B]
    rarity: 2
  39:
    name: [Wheel Cat]
    rarity: 2
  42:
    name: [Salon Cat]
    rarity: 2
  43:
    name: [Ice Cat, Ice Queen]
    rarity: 4
  50:
    name: [Unused Cat]
    rarity: 2
gacha:
  100:
    cats: [38, 39, 42, 31, 43]
    series_id: 1
    name: Test gacha
    rate: regular
  200:
    cats: [43]
    series_id: 2
    name: Platinum gacha
    rate: platinum
banners:
  1:
    name: Something else
events:
  2026-01-01_100:
    start_on: 2026-01-01
    end_on: 2026-01-05
    version: '150000'
    name: "Long gone"
    id: 100
    rare: 7000
    supa: 2500
    uber: 500
  2026-10-20_100:
    start_on: 2026-10-20
    end_on: 2026-10-25
    version: '150600'
    name: "Running now ★"
    id: 100
    rare: 7000
    supa: 2500
    uber: 500
    guaranteed: true
  2026-10-30_200:
    start_on: 2026-10-30
    end_on: 2030-01-01
    version: '150600'
    name: "Get an Uber Rare Cat!! 100% Uber drop Rate in the PLATINUM CAPSULES!"
    id: 200
    rare: 0
    supa: 0
    uber: 10000
    platinum: platinum
`;

// Two Platinum Capsules of the same gacha series (godfat's data lists both
// "until 2030") and one of another series.
const SERIES_YAML = `\
cats:
  43:
    name: [Ice Cat]
    rarity: 4
gacha:
  200:
    cats: [43]
    series_id: 2
    name: Platinum gacha
    rate: platinum
  201:
    cats: [43]
    series_id: 2
    name: Platinum gacha, newer pool
    rate: platinum
  300:
    cats: [43]
    series_id: 3
    name: Another series
    rate: platinum
events:
  2026-07-11_200:
    start_on: 2026-07-11
    end_on: 2030-01-01
    name: "Old platinum"
    id: 200
    uber: 10000
    platinum: platinum
  2026-10-20_201:
    start_on: 2026-10-20
    end_on: 2030-01-01
    name: "Current platinum"
    id: 201
    uber: 10000
    platinum: platinum
  2026-10-21_300:
    start_on: 2026-10-21
    end_on: 2030-01-01
    name: "Other series"
    id: 300
    uber: 10000
    platinum: platinum
`;

test("extract keeps only current events, their gachas and their cats", () => {
  const data = extract(MINI_YAML, { today: TODAY });
  assert.deepEqual(Object.keys(data.events), ["2026-10-20_100", "2026-10-30_200"]); // 2026-01 ended long ago
  assert.deepEqual(data.gacha, { 100: [38, 39, 42, 31, 43], 200: [43] });
  // First form names; cats no current gacha has are dropped.
  assert.deepEqual(data.cats, { 31: ["Bodhisattva Cat", 3], 38: ["Pogo Cat", 2], 39: ["Wheel Cat", 2],
    42: ["Salon Cat", 2], 43: ["Ice Cat", 4] });
  assert.deepEqual(data.events["2026-10-20_100"], { start_on: "2026-10-20", end_on: "2026-10-25", name: "Running now ★",
    id: 100, rare: 7000, supa: 2500, uber: 500, guaranteed: true });
  assert.equal(data.events["2026-10-30_200"].platinum, "platinum");
  // The file format reads back to the same data.
  assert.deepEqual(JSON.parse(dumps(data)), data);
});

test("extract only looks at godfat's most recent events", () => {
  // His menu considers his last 100 events; with a window of 1 only the
  // newest one can be upcoming, even if older ones haven't ended.
  assert.deepEqual(Object.keys(extract(MINI_YAML, { today: TODAY, eventsShown: 1 }).events), ["2026-10-30_200"]);
});

test("a newer event of the same series ends the older one", () => {
  // As on godfat's site: the old capsule ends the day the new one starts.
  const data = extract(SERIES_YAML, { today: TODAY });
  assert.deepEqual(Object.fromEntries(Object.entries(data.events).map(([k, ev]) => [k, ev.end_on])), {
    "2026-07-11_200": "2026-10-20", "2026-10-20_201": "2030-01-01", "2026-10-21_300": "2030-01-01" });
  const ds = new Dataset(data);
  assert.deepEqual(ds.upcoming(TODAY).map((e) => e.event_id), ["2026-10-20_201", "2026-10-21_300"]);
  assert.deepEqual(ds.upcoming("2026-10-20").map((e) => e.event_id), ["2026-07-11_200", "2026-10-20_201", "2026-10-21_300"]);
  // Ended more than KEEP_DAYS ago: not kept at all.
  assert.ok(!("2026-07-11_200" in extract(SERIES_YAML, { today: "2026-11-01" }).events));
});

test("extract refuses data it can't use", () => {
  assert.throws(() => extract("not: [godfat, data]\n", { today: TODAY }), /no 'cats' section/);
  assert.throws(() => extract(MINI_YAML, { today: "2031-01-01" }), /no current events/);
});

test("the Upcoming list: running now, then starting later", () => {
  const ds = new Dataset(extract(MINI_YAML, { today: TODAY }));
  const events = ds.upcoming(TODAY);
  assert.deepEqual(events.map((e) => e.event_id), ["2026-10-20_100", "2026-10-30_200"]);
  assert.deepEqual(events.map((e) => e.banner_type), [pathfinder.BANNER_NORMAL, pathfinder.BANNER_PLATINUM]);
  assert.deepEqual(events[0], { event_id: "2026-10-20_100", description: "Running now ★", date_start: "2026-10-20",
    date_end: "2026-10-25", banner_type: pathfinder.BANNER_NORMAL });
  assert.deepEqual(ds.upcoming("2026-10-26").map((e) => e.event_id), ["2026-10-30_200"]);
});

test("banners are built with their guaranteed cells", () => {
  const ds = new Dataset(extract(MINI_YAML, { today: TODAY }));
  const banner = ds.banner(12345, "2026-10-20_100", 30);
  assert.equal(banner.name, "Running now ★");
  assert.equal(banner.type, pathfinder.BANNER_NORMAL);
  assert.equal(Object.keys(banner.rolls).length, 60);
  assert.ok(banner.hasGuaranteed);
  const units = new Set(Object.values(banner.rolls).map((e) => e.unit));
  for (const u of units) assert.ok(["Pogo Cat", "Wheel Cat", "Salon Cat", "Bodhisattva Cat", "Ice Cat"].includes(u), u);
  assert.equal(banner.rolls["1A"].guaranteed_unit, "Ice Cat"); // the only uber
  assert.equal(ds.banner(12345, "no-such-event", 30), null);
});

test("a search's banners skip what can't be rolled, and seeds are checked", () => {
  const ds = new Dataset(extract(MINI_YAML, { today: TODAY }));
  const ing = ingest(ds, "12345", 20, {
    resources: { rare_tickets: 5 }, eventIds: ["2026-10-20_100", "2026-10-30_200", "nope"], today: TODAY,
  });
  assert.deepEqual(ing.banners.map((b) => b.name), ["Running now ★"]);
  assert.deepEqual(new Set(ing.skipped.map((s) => `${s.event_id}: ${s.reason}`)),
    new Set(["2026-10-30_200: no platinum tickets", "nope: unknown event"]));
  assert.throws(() => ingest(ds, "12a45", 20, { eventIds: ["2026-10-20_100"] }), /invalid seed/);
  assert.throws(() => ingest(ds, String(2 ** 32), 20, { eventIds: ["2026-10-20_100"] }), /invalid seed/);
});

test("the site's data file is in the extract's format", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const data = JSON.parse(readFileSync(join(here, "..", "public", "data", "godfat_bcen.json"), "utf8"));
  assert.equal(data._meta.source, SOURCE_URL);
  assert.equal(readFileSync(join(here, "..", "public", "data", "godfat_bcen.json"), "utf8"), dumps(data));
});
