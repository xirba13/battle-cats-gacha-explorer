// Verification harness for owncode.js (run: node frontend/verify_owncode.mjs).
// Exercises the REAL encode/decode (needs Node 18+ for CompressionStream/btoa).
// Round-trips every collection shape AND proves shared links survive a future
// mid-guide insertion (the reason the bitmask keys on stable uid, not gi).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encodeOwned, decodeOwned } from "./src/owncode.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); // repo root
const master = JSON.parse(readFileSync(join(ROOT, "backend/data/cat_guide_master.json"), "utf8"));
const units = master.units;

const buildMaps = (us) => {
  const idToUid = new Map(), uidToId = new Map(), giToName = new Map();
  for (const u of us) { idToUid.set(u.global_index, u.uid); uidToId.set(u.uid, u.global_index); giToName.set(u.global_index, u.name); }
  return { idToUid, uidToId, giToName };
};
const v1 = buildMaps(units);

// base64url -> first byte (format tag), for reporting which candidate won.
const tagOf = (code) => {
  if (!code) return "-";
  let s = code.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  return { 1: "raw", 2: "deflate", 3: "list" }[Buffer.from(s, "base64")[0]] || "?";
};
const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

const giAll = units.map((u) => u.global_index);
const eggGis = units.filter((u) => /Ancient Egg/.test(u.name)).map((u) => u.global_index);
const range = (lo, hi) => giAll.filter((g) => g >= lo && g < hi);
const seed = (() => { let s = 1234567; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const rnd = (p) => new Set(giAll.filter(() => seed() < p));

const shapes = {
  "empty": new Set(),
  "new player (gi 0..29)": new Set(range(0, 30)),
  "new + 1 high (gi 0..20,729)": new Set([...range(0, 21), 729]),
  "sparse scattered": new Set([0, 1, 2, 3, 5, 8, 40, 120, 300, 500, 729]),
  "own ~half random": rnd(0.5),
  "structured 0..400+half": new Set([...range(0, 400), ...range(400, 600).filter(() => seed() < 0.5)]),
  "near-complete (~96%)": new Set(giAll.filter(() => seed() > 0.04)),
  "complete dex (all 730)": new Set(giAll),
  "single egg": new Set([eggGis[0]]),
  "all 24 eggs": new Set(eggGis),
  "eggs + gi 0..50": new Set([...eggGis, ...range(0, 51)]),
};

let pass = 0, fail = 0;
console.log("shape".padEnd(30), "n".padStart(4), " fmt".padEnd(9), "chars", "  round-trip");
for (const [name, set] of Object.entries(shapes)) {
  const code = await encodeOwned(set, v1.idToUid);
  const back = await decodeOwned(code, v1.uidToId);
  const ok = eq(set, back);
  ok ? pass++ : fail++;
  console.log(name.padEnd(30), String(set.size).padStart(4), (" " + tagOf(code)).padEnd(9),
    String(code.length).padStart(5), "  " + (ok ? "OK" : "*** MISMATCH ***"));
}

// ---- Insertion simulation: a new unit lands mid-guide in a FUTURE master. ----
// v2 = same real units, but a brand-new unit (uid 860) is spliced in at guide
// position 100, so every later unit's global_index shifts by +1; uids unchanged.
const INSERT_AT = 100;
const v2Units = units.map((u) => ({ ...u }));
v2Units.splice(INSERT_AT, 0, { global_index: -1, uid: 860, name: "__NEW_UNIT__", icon: "Uni860_f00.png" });
v2Units.forEach((u, i) => (u.global_index = i)); // renumber display positions
const v2 = buildMaps(v2Units);

// Own a set that includes units on BOTH sides of the insertion point + an egg.
const ownGi = new Set([0, 1, 5, 99, 100, 101, 200, 500, 729, eggGis[3]]);
const ownNames = new Set([...ownGi].map((g) => v1.giToName.get(g)));      // what we owned (v1)
const code = await encodeOwned(ownGi, v1.idToUid);                         // saved under v1
const decodedV2 = await decodeOwned(code, v2.uidToId);                     // opened under v2
const decodedNames = new Set([...decodedV2].map((g) => v2.giToName.get(g)));
const insertionOk = eq(ownNames, decodedNames);
const giShifted = [...ownGi].some((g) => g >= INSERT_AT); // sanity: some gis really moved
insertionOk ? pass++ : fail++;
console.log("\nInsertion test: encode under v1, decode under v2 (new unit at guide pos 100)");
console.log("  owned unit names preserved across insertion:", insertionOk ? "OK" : "*** MISMATCH ***",
  "| gi actually shifted for some:", giShifted);
if (!insertionOk) {
  console.log("  owned :", [...ownNames].sort());
  console.log("  got   :", [...decodedNames].sort());
}

// Empty-set contract: encode() must yield "" (so the URL omits `o`).
const emptyOk = (await encodeOwned(new Set(), v1.idToUid)) === "" && (await decodeOwned("", v1.uidToId)).size === 0;
emptyOk ? pass++ : fail++;
console.log("Empty-set contract (code is '' both ways):", emptyOk ? "OK" : "*** FAIL ***");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
