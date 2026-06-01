// Encode/decode the player's owned-units set into a compact, URL-safe code, and
// (de)serialize the whole client state (owned + seed + resources) to the URL
// hash. Nothing is stored on a server — the URL *is* the save file.

const VERSION = 1;

function bytesToBase64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Owned set (of global_index numbers) <-> code string.
export function encodeOwned(ownedSet) {
  if (!ownedSet || ownedSet.size === 0) return "";
  let max = 0;
  for (const idx of ownedSet) if (idx > max) max = idx;
  const bits = new Uint8Array(Math.floor(max / 8) + 1);
  for (const idx of ownedSet) bits[idx >> 3] |= 1 << (idx & 7);
  const out = new Uint8Array(bits.length + 1);
  out[0] = VERSION;
  out.set(bits, 1);
  return bytesToBase64url(out);
}

export function decodeOwned(code) {
  const set = new Set();
  if (!code) return set;
  let bytes;
  try {
    bytes = base64urlToBytes(code);
  } catch {
    return set;
  }
  if (bytes.length === 0) return set;
  // bytes[0] is the version; the rest is the bitmask.
  for (let i = 1; i < bytes.length; i++) {
    const b = bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      if (b & (1 << bit)) set.add((i - 1) * 8 + bit);
    }
  }
  return set;
}

const RES_KEYS = ["rare_tickets", "cat_food", "platinum_tickets", "legend_tickets"];

function encodeResources(r) {
  return RES_KEYS.map((k) => r[k] || 0).join(".");
}

function decodeResources(s) {
  const out = { rare_tickets: 0, cat_food: 0, platinum_tickets: 0, legend_tickets: 0 };
  if (!s) return out;
  const parts = s.split(".");
  RES_KEYS.forEach((k, i) => {
    const n = parseInt(parts[i], 10);
    if (!Number.isNaN(n) && n >= 0) out[k] = n;
  });
  return out;
}

// Whole-state <-> URL hash (#o=<code>&s=<seed>&r=a.b.c.d).
export function readStateFromHash() {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return {
    owned: decodeOwned(p.get("o") || ""),
    seed: p.get("s") || "",
    resources: decodeResources(p.get("r")),
  };
}

export function buildHash({ owned, seed, resources }) {
  const p = new URLSearchParams();
  const code = encodeOwned(owned);
  if (code) p.set("o", code);
  if (seed) p.set("s", seed);
  p.set("r", encodeResources(resources));
  return "#" + p.toString();
}

export function writeStateToHash(state) {
  history.replaceState(null, "", buildHash(state));
}
