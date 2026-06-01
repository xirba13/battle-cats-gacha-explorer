// Encode/decode the player's owned-units set into a compact, URL-safe code, and
// (de)serialize the rest of the client state (seed + resources) to the URL hash.
// Nothing is stored on a server — the URL *is* the save file.
//
// The owned set is a bitmask (1 bit per global_index). We store whichever is
// smaller, behind a 1-byte format tag:
//   0x01  raw bitmask          (trailing zero bytes trimmed)
//   0x02  raw-deflate bitmask  (CompressionStream; great on real collections)
// then base64url. Picking the smaller means it's never worse than raw.
//
// Scalability: nothing here hardcodes the unit count. The bitmask only spans up
// to the highest owned index (trailing-trimmed) and decode reads whatever bits
// are present, so as new units are appended to the master list (higher indices)
// existing codes stay valid — new units simply read as not-owned. The format
// byte leaves room for future schemes without breaking old links.

const FMT_RAW = 0x01;
const FMT_DEFLATE = 0x02;

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

function bitmaskBytes(set) {
  let max = 0;
  for (const i of set) if (i > max) max = i;
  const ba = new Uint8Array((max >> 3) + 1);
  for (const i of set) ba[i >> 3] |= 1 << (i & 7);
  return ba;
}

function withTag(tag, bytes) {
  const out = new Uint8Array(bytes.length + 1);
  out[0] = tag;
  out.set(bytes, 1);
  return out;
}

async function deflateRaw(bytes) {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// Owned set (of global_index numbers) -> code string (async: may compress).
export async function encodeOwned(ownedSet) {
  if (!ownedSet || ownedSet.size === 0) return "";
  const bits = bitmaskBytes(ownedSet);
  let best = withTag(FMT_RAW, bits);
  if (typeof CompressionStream !== "undefined") {
    try {
      const deflated = await deflateRaw(bits);
      if (deflated.length + 1 < best.length) best = withTag(FMT_DEFLATE, deflated);
    } catch {
      /* fall back to raw */
    }
  }
  return bytesToBase64url(best);
}

// Code string -> owned set (async: may decompress).
export async function decodeOwned(code) {
  const set = new Set();
  if (!code) return set;
  let bytes;
  try {
    bytes = base64urlToBytes(code);
  } catch {
    return set;
  }
  if (bytes.length === 0) return set;
  const fmt = bytes[0];
  let bits = bytes.subarray(1);
  if (fmt === FMT_DEFLATE) {
    if (typeof DecompressionStream === "undefined") return set;
    try {
      bits = await inflateRaw(bits);
    } catch {
      return set;
    }
  } else if (fmt !== FMT_RAW) {
    return set; // unknown/future format
  }
  for (let i = 0; i < bits.length; i++) {
    const b = bits[i];
    for (let bit = 0; bit < 8; bit++) if (b & (1 << bit)) set.add(i * 8 + bit);
  }
  return set;
}

// ---- seed + resources (small, kept uncompressed) ------------------------- //
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

// Synchronous read of the hash: owned stays a code string (decode it with
// decodeOwned), seed + resources are parsed directly.
export function readRawState() {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return {
    ownedCode: p.get("o") || "",
    seed: p.get("s") || "",
    resources: decodeResources(p.get("r")),
  };
}

export function buildHash({ ownedCode, seed, resources }) {
  const p = new URLSearchParams();
  if (ownedCode) p.set("o", ownedCode);
  if (seed) p.set("s", seed);
  p.set("r", encodeResources(resources));
  return "#" + p.toString();
}

export function writeHash(state) {
  history.replaceState(null, "", buildHash(state));
}
