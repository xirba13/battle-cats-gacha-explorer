// The browser engine (src/engine) against the Python reference (backend/app):
// tests/fixtures/golden.json holds the Python's own roll tables, Upcoming
// lists, search results and "I followed this path" results (see
// make_golden.py), and the JavaScript must give exactly the same ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Dataset, parseSeed } from "../src/engine/data.js";
import { advance, retreat } from "../src/engine/rolls.js";
import { MasterData, followedResult, searchRequest } from "../src/engine/services.js";

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (...parts) => JSON.parse(readFileSync(join(here, ...parts), "utf8"));
const golden = readJson("fixtures", "golden.json");
const datasets = Object.fromEntries(Object.entries(golden.datasets).map(([k, v]) => [k, new Dataset(v)]));
const master = new MasterData(golden.master);

// The Python's json.dumps(sort_keys=True, ensure_ascii=False, separators=(",", ":")).
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}
const digest = (v) => createHash("sha256").update(canonical(v), "utf8").digest("hex");

test("xorshift32 and its inverse", () => {
  let s = 139026851;
  for (let i = 0; i < 1000; i++) {
    assert.equal(retreat(advance(s)), s);
    s = advance(s);
    assert.ok(s >= 0 && s <= 0xffffffff);
  }
  // A cat's link carries the seed after pulling it; 1A's is two steps in.
  const first = golden.tables.find((t) => t.data === "fixture" && t.seed === 139026851).first;
  assert.equal(retreat(retreat(Number(first.unit_seed))), 139026851);
});

test("roll tables match the Python's, cell for cell", () => {
  for (const t of golden.tables) {
    const banner = datasets[t.data].banner(t.seed, t.event_id, t.count);
    const where = `${t.data} ${t.event_id} seed ${t.seed}`;
    if (t.none) {
      assert.equal(banner, null, where);
      continue;
    }
    assert.equal(Object.keys(banner.rolls).length, t.cells, where);
    assert.deepEqual(banner.rolls["1A"], t.first, where);
    assert.equal(digest(banner.rolls), t.digest, where);
  }
  assert.ok(golden.tables.length > 100);
});

test("the Upcoming list matches the Python's", () => {
  for (const u of golden.upcoming) {
    assert.deepEqual(datasets[u.data].upcoming(u.today), u.events, `${u.data} on ${u.today}`);
  }
});

// The parts of a search result the Python's run_search (+ ingest) gives.
const PYTHON_KEYS = ["targets", "owned_in_banners", "unmatched", "banners", "units", "solutions", "skipped"];

for (const s of golden.searches) {
  test(`search: ${s.title}`, () => {
    const result = searchRequest(datasets[s.data], master, s.body, { today: s.today, maxSteps: s.max_steps });
    const first = result.solutions[0];
    // Readable checks first, then everything.
    assert.deepEqual({
      targets: result.targets.length,
      solutions: result.solutions.length,
      skipped: result.skipped,
      best_cost: first ? first.cost : null,
      best_steps: first ? first.actions.map((a) => `${a.banner_index}:${a.action_type}:${a.position_from}>${a.position_to}`) : null,
    }, s.summary);
    assert.equal(digest(Object.fromEntries(PYTHON_KEYS.map((k) => [k, result[k]]))), s.digest);
    for (const sol of result.solutions) assert.ok(sol.verified, sol.verify_errors.join("; "));
  });
}

test("a search can stop on time and still return checked paths", () => {
  const s = golden.searches.find((x) => x.title.startsWith("every banner"));
  const result = searchRequest(datasets[s.data], master, s.body, { today: s.today, maxSteps: 10_000_000, timeLimitMs: 50 });
  assert.equal(result.search.stopped, "time");
  assert.ok(result.solutions.length > 0);
  for (const sol of result.solutions) assert.ok(sol.verified);
});

test("a search can stop at a number of states (memory) too", () => {
  const s = golden.searches.find((x) => x.title.startsWith("every banner"));
  const result = searchRequest(datasets[s.data], master, s.body, { today: s.today, maxSteps: 10_000_000, maxStates: 5000 });
  assert.equal(result.search.stopped, "states");
  for (const sol of result.solutions) assert.ok(sol.verified);
});

test('"I followed this path" matches the Python\'s', () => {
  assert.ok(golden.followed.length > 0);
  for (const f of golden.followed) {
    assert.deepEqual(followedResult(master, f.solution, f.owned, f.resources), f.result);
  }
});

test("seeds must be whole numbers from 0 to 2^32 - 1", () => {
  assert.equal(parseSeed(" 139026851 "), 139026851);
  assert.equal(parseSeed("4294967295"), 4294967295);
  for (const bad of ["", "12a45", "-1", "4294967296", "1.5", null]) assert.throws(() => parseSeed(bad), /invalid seed/);
});

test("the shipped data loads, and each Upcoming banner can be rolled", () => {
  const data = new Dataset(readJson("..", "public", "data", "godfat_bcen.json"));
  assert.ok(data.meta.built_on);
  for (const ev of Object.values(data.events)) assert.ok(data.gacha.has(ev.id), ev.name);
  const day = data.meta.built_on;
  const events = data.upcoming(day);
  assert.ok(events.length > 0);
  for (const e of events) assert.ok(data.banner(139026851, e.event_id, 30), e.event_id);
});

test("the page's Cat Guide list is the backend's (while the backend exists)", () => {
  const backendCopy = join(here, "..", "..", "backend", "data", "cat_guide_master.json");
  if (!existsSync(backendCopy)) return;
  assert.equal(readFileSync(join(here, "..", "public", "data", "cat_guide_master.json"), "utf8"),
    readFileSync(backendCopy, "utf8"));
});
