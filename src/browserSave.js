// The player's state saved in this browser too (localStorage), so opening the
// site without a link brings it back. It's the same codes as the page URL (the
// owned code keys on stable uids, so it survives Cat Guide updates), plus when
// it was saved. Per browser and device; the link or code still moves it to
// another one. Storage can be unavailable (blocked, private mode, full), so
// every call here fails quietly.
import { decodeOwned, decodeResources, encodeResources } from "./owncode.js";

const KEY = "bcge.saved.v1";
const OFF_KEY = "bcge.saveOff"; // "1" = don't save in this browser

let store;
function storage() {
  if (store !== undefined) return store;
  try {
    const s = globalThis.localStorage;
    s.setItem("bcge.probe", "1");
    s.removeItem("bcge.probe");
    store = s;
  } catch {
    store = null;
  }
  return store;
}

// Can this browser save at all?
export const canSave = () => storage() !== null;

// Has the player turned saving off in this browser?
export function savingOff() {
  try {
    return storage()?.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

// Turn saving off (which also forgets what was saved) or back on.
export function setSavingOff(off) {
  try {
    const s = storage();
    if (!s) return;
    if (off) {
      s.removeItem(KEY);
      s.setItem(OFF_KEY, "1");
    } else {
      s.removeItem(OFF_KEY);
    }
  } catch {
    /* nothing to do */
  }
}

// What this browser saved: {ownedCode, seed, resources, lastCat, tab,
// wishCode, planCode, savedAt}, or null.
export function loadSaved() {
  try {
    const d = JSON.parse(storage()?.getItem(KEY) || "null");
    if (!d || typeof d !== "object") return null;
    return {
      ownedCode: String(d.o || ""),
      seed: String(d.s || ""),
      resources: decodeResources(d.r),
      lastCat: Number.isInteger(d.l) ? d.l : null,
      tab: String(d.t || ""),
      wishCode: String(d.w || ""),
      planCode: String(d.p || ""),
      savedAt: d.at || null,
    };
  } catch {
    return null;
  }
}

export function save({ ownedCode, seed, resources, lastCat = null, tab, wishCode, planCode }) {
  try {
    storage()?.setItem(KEY, JSON.stringify({
      o: ownedCode || "", s: seed || "", r: encodeResources(resources), l: lastCat, t: tab || "", w: wishCode || "",
      p: planCode || "", at: new Date().toISOString(),
    }));
  } catch {
    /* full or blocked: the URL still has it */
  }
}

// Does this state hold anything (owned units, a seed, any resources,
// wishlists, a plan)?
export const hasData = (s) =>
  Boolean(s.ownedCode || s.seed || s.wishCode || s.planCode || Object.values(s.resources).some((v) => v > 0));

// Compare the URL's state with the saved one. Owned codes are compared by
// the units they hold (an old link may use another encoding of the same set);
// the wishlists and the plan by their codes.
export async function compareStates(a, b, uidToId) {
  const [ownedA, ownedB] = await Promise.all([decodeOwned(a.ownedCode, uidToId), decodeOwned(b.ownedCode, uidToId)]);
  const same = a.seed === b.seed
    && encodeResources(a.resources) === encodeResources(b.resources)
    && (a.lastCat ?? null) === (b.lastCat ?? null)
    && (a.wishCode || "") === (b.wishCode || "") && (a.planCode || "") === (b.planCode || "")
    && ownedA.size === ownedB.size && [...ownedA].every((i) => ownedB.has(i));
  return { same, ownedA, ownedB };
}
