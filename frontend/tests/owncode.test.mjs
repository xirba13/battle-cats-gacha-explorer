// Self-contained Node test for the URL owned-code (no test runner needed):
//   node tests/owncode.test.mjs   (or: pnpm test)
//
// Locks in the two properties that matter:
//   1. encode -> decode round-trips for dense / sparse / egg / empty sets.
//   2. INSERTION-SAFETY: a code made before a unit is inserted mid-guide still
//      decodes to the exact same units afterwards (no false "owned"), because
//      it keys on stable `uid`, not the renumbered `global_index`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encodeOwned, decodeOwned } from "../src/owncode.js";

const here = dirname(fileURLToPath(import.meta.url));
const master = JSON.parse(
  readFileSync(join(here, "..", "..", "backend", "data", "cat_guide_master.json"), "utf-8")
).units;

function maps(units) {
  const idToUid = new Map(), uidToId = new Map(), giToName = new Map();
  units.forEach((u, gi) => { idToUid.set(gi, u.uid); uidToId.set(u.uid, gi); giToName.set(gi, u.name); });
  return { idToUid, uidToId, giToName };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("  ok -", name);
}

const v1 = maps(master);

await test("round-trips for dense / sparse / egg / empty", async () => {
  const eggGi = master.findIndex((u) => u.uid >= 100000);
  const sets = {
    full: new Set(master.map((_, gi) => gi)),
    sparse: new Set([0, 5, 200, eggGi]),
    singleEgg: new Set([eggGi]),
    empty: new Set(),
  };
  for (const [label, set] of Object.entries(sets)) {
    const code = await encodeOwned(set, v1.idToUid);
    const back = await decodeOwned(code, v1.uidToId);
    assert.equal(back.size, set.size, `size mismatch (${label})`);
    for (const gi of set) assert.ok(back.has(gi), `missing ${gi} (${label})`);
  }
});

await test("mid-guide insertion does not shift or falsely-own units", async () => {
  const eggGi = master.findIndex((u) => u.uid >= 100000);
  const ownedV1 = new Set([0, 5, 199, 200, 205, 400, eggGi]);
  const namesV1 = [...ownedV1].map((gi) => v1.giToName.get(gi)).sort();
  const code = await encodeOwned(ownedV1, v1.idToUid);

  // Insert a brand-new unit at display index 200 (everything >=200 renumbers).
  const newUid = Math.max(...master.filter((u) => u.uid < 100000).map((u) => u.uid)) + 1;
  const v2units = [...master];
  v2units.splice(200, 0, { uid: newUid, name: "NEW INSERTED UNIT" });
  const v2 = maps(v2units);

  const decoded = await decodeOwned(code, v2.uidToId);
  const namesV2 = [...decoded].map((gi) => v2.giToName.get(gi)).sort();

  assert.deepEqual(namesV2, namesV1, "decoded to different units after insertion");
  assert.ok(!namesV2.includes("NEW INSERTED UNIT"), "inserted unit was falsely owned");
  // Sanity: the insertion really did renumber display order.
  assert.notEqual(v1.giToName.get(205), v2.giToName.get(205));
});

await test("decode skips uids absent from the current master", async () => {
  // Hand-build a list-format code containing a uid that doesn't exist.
  const code = await encodeOwned(new Set([0]), new Map([[0, 999999]]));
  const back = await decodeOwned(code, v1.uidToId); // 999999 not in master
  assert.equal(back.size, 0);
});

console.log(`\n${passed} owncode tests passed.`);
