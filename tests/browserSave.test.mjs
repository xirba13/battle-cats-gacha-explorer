// Saving the player's state in the browser (src/browserSave.js), against a
// fake localStorage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeOwned } from "../src/owncode.js";

class FakeStorage {
  constructor() {
    this.items = new Map();
  }
  getItem(k) {
    return this.items.has(k) ? this.items.get(k) : null;
  }
  setItem(k, v) {
    this.items.set(k, String(v));
  }
  removeItem(k) {
    this.items.delete(k);
  }
  get length() {
    return this.items.size;
  }
  key(i) {
    return [...this.items.keys()][i] ?? null;
  }
}
const setStorage = (value) =>
  Object.defineProperty(globalThis, "localStorage", { value, configurable: true, writable: true });
const fake = new FakeStorage();
setStorage(fake);
const bs = await import("../src/browserSave.js");

const here = dirname(fileURLToPath(import.meta.url));
const units = JSON.parse(readFileSync(join(here, "..", "public", "data", "cat_guide_master.json"), "utf8")).units;
const idToUid = new Map(units.map((u) => [u.global_index, u.uid]));
const uidToId = new Map(units.map((u) => [u.uid, u.global_index]));
const res = (rt, cf, pt, lt) => ({ rare_tickets: rt, cat_food: cf, platinum_tickets: pt, legend_tickets: lt });

test("what's saved comes back", async () => {
  const ownedCode = await encodeOwned(new Set([0, 5, 100]), idToUid);
  const state = {
    ownedCode, seed: "139026851", resources: res(30, 45000, 2, 2), lastCat: 32, tab: "paths", wishCode: "AQAB", planCode: "AQCD",
  };
  bs.save(state);
  const back = bs.loadSaved();
  assert.deepEqual({ ...back, savedAt: undefined }, { ...state, savedAt: undefined });
  assert.ok(!Number.isNaN(Date.parse(back.savedAt)));
  assert.ok(bs.canSave());
});

test("a copy saved before wishlists and plans comes back without them", () => {
  fake.setItem("bcge.saved.v1", JSON.stringify({ o: "", s: "5", r: "1.2.3.4", t: "guide", at: "2026-10-24T10:00:00Z" }));
  const back = bs.loadSaved();
  assert.equal(back.wishCode, "");
  assert.equal(back.planCode, "");
  assert.equal(back.lastCat, null);
  assert.equal(back.seed, "5");
});

test("turning saving off forgets the saved copy; back on saves again", () => {
  bs.save({ ownedCode: "", seed: "1", resources: res(0, 0, 0, 0), tab: "" });
  bs.setSavingOff(true);
  assert.equal(bs.savingOff(), true);
  assert.equal(bs.loadSaved(), null);
  bs.setSavingOff(false);
  assert.equal(bs.savingOff(), false);
});

test("a broken saved value is ignored", () => {
  fake.setItem("bcge.saved.v1", "{not json");
  assert.equal(bs.loadSaved(), null);
});

test("hasData: owned units, a seed, any resources, wishlists or a plan", () => {
  assert.equal(bs.hasData({ ownedCode: "", seed: "", resources: res(0, 0, 0, 0) }), false);
  assert.equal(bs.hasData({ ownedCode: "", seed: "5", resources: res(0, 0, 0, 0) }), true);
  assert.equal(bs.hasData({ ownedCode: "", seed: "", resources: res(0, 150, 0, 0) }), true);
  assert.equal(bs.hasData({ ownedCode: "", seed: "", resources: res(0, 0, 0, 0), wishCode: "AQAB" }), true);
  assert.equal(bs.hasData({ ownedCode: "", seed: "", resources: res(0, 0, 0, 0), planCode: "AQCD" }), true);
});

test("states compare by the units they hold, not by how they're encoded", async () => {
  const set = new Set([0, 1, 2]);
  const code = await encodeOwned(set, idToUid);
  // The same three units as a raw bitmask (format 0x01), however encodeOwned chose.
  const bits = [...set].reduce((b, gi) => b | (1 << idToUid.get(gi)), 0);
  const raw = Buffer.from([1, bits]).toString("base64url");
  const a = { ownedCode: code, seed: "7", resources: res(1, 2, 3, 4) };
  assert.equal((await bs.compareStates(a, { ...a, ownedCode: raw }, uidToId)).same, true);
  assert.equal((await bs.compareStates(a, { ...a, seed: "8" }, uidToId)).same, false);
  assert.equal((await bs.compareStates(a, { ...a, resources: res(1, 2, 3, 5) }, uidToId)).same, false);
  assert.equal((await bs.compareStates(a, { ...a, wishCode: "AQAB" }, uidToId)).same, false);
  assert.equal((await bs.compareStates(a, { ...a, planCode: "AQCD" }, uidToId)).same, false);
  assert.equal((await bs.compareStates({ ...a, wishCode: "" }, a, uidToId)).same, true);
  assert.equal((await bs.compareStates(a, { ...a, lastCat: 32 }, uidToId)).same, false);
  const other = await encodeOwned(new Set([0, 1]), idToUid);
  const cmp = await bs.compareStates(a, { ...a, ownedCode: other }, uidToId);
  assert.equal(cmp.same, false);
  assert.deepEqual([cmp.ownedA.size, cmp.ownedB.size], [3, 2]);
});

test("without usable storage nothing breaks", async () => {
  setStorage({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} });
  const fresh = await import("../src/browserSave.js?blocked");
  assert.equal(fresh.canSave(), false);
  assert.equal(fresh.loadSaved(), null);
  assert.equal(fresh.savingOff(), false);
  fresh.save({ ownedCode: "", seed: "1", resources: res(0, 0, 0, 0), tab: "" });
  fresh.setSavingOff(true);
  setStorage(fake);
});

test("page preferences are kept while saving is on, and forgotten with it", () => {
  bs.setSavingOff(false);
  bs.savePref("explain", "1");
  assert.equal(bs.loadPref("explain"), "1");
  bs.setSavingOff(true);
  assert.equal(bs.loadPref("explain"), null);
  bs.savePref("explain", "1");
  assert.equal(bs.loadPref("explain"), null);
  bs.setSavingOff(false);
});
