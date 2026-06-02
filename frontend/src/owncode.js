// Encode/decode the player's owned-units set into a compact, URL-safe code, and
// (de)serialize the rest of the client state (seed + resources) to the URL hash.
// Nothing is stored on a server — the URL *is* the save file.
//
// The owned set is a bitmask, but keyed on each unit's STABLE in-game id (`uid`),
// NOT its Cat Guide display position (`global_index`). global_index renumbers
// whenever a unit is inserted mid-guide, which would silently corrupt every
// shared link; a uid only ever grows as new units are released, so old codes
// stay valid. The runtime keeps using global_index everywhere else — the caller
// passes the global_index<->uid maps (from the master list) so we translate only
// at this URL boundary.
//
// We store whichever payload is smallest, behind a 1-byte format tag:
//   0x01  raw bitmask               (trailing zero bytes trimmed)
//   0x02  raw-deflate bitmask        (CompressionStream; great on dense dexes)
//   0x03  sorted-delta varint list   (great on sparse collections / high uids)
// then base64url. Picking the smallest means it's never worse than raw.
//
// Scalability: nothing hardcodes the unit count. The bitmask spans only up to the
// highest owned uid (trailing-trimmed) and decode reads whatever is present, so
// new (higher-uid) units read as not-owned in old codes. uids absent from the
// current master (e.g. a retired unit) are skipped on decode. The format byte
// leaves room for future schemes without breaking old links.

const FMT_RAW = 0x01;
const FMT_DEFLATE = 0x02;
const FMT_LIST = 0x03;

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

// Bitmask over uids: bit `uid` set iff owned. Trailing zero bytes are implicit
// (the array spans only up to the highest owned uid).
function bitmaskBytes(uids) {
  let max = 0;
  for (const i of uids) if (i > max) max = i;
  const ba = new Uint8Array((max >> 3) + 1);
  for (const i of uids) ba[i >> 3] |= 1 << (i & 7);
  return ba;
}

// Sorted uids as unsigned-LEB128 gaps (first gap = the value, since prev=0).
// Tiny for sparse sets and for sets with a few very high uids (e.g. eggs).
function varintListBytes(uids) {
  const out = [];
  let prev = 0;
  for (const v of [...uids].sort((a, b) => a - b)) {
    let d = v - prev;
    prev = v;
    while (d >= 0x80) { out.push((d & 0x7f) | 0x80); d >>>= 7; }
    out.push(d);
  }
  return new Uint8Array(out);
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

// Owned set (of global_index numbers) -> code string. Keyed on stable uid via
// idToUid (Map<global_index, uid>); global_index values without a uid (not in
// the master) are skipped. Async: may compress.
export async function encodeOwned(ownedSet, idToUid) {
  if (!ownedSet || ownedSet.size === 0 || !idToUid) return "";
  const uids = [];
  for (const gi of ownedSet) {
    const uid = idToUid.get(gi);
    if (uid !== undefined) uids.push(uid);
  }
  if (uids.length === 0) return "";

  const bits = bitmaskBytes(uids);
  let best = withTag(FMT_RAW, bits);

  const list = varintListBytes(uids);
  if (list.length + 1 < best.length) best = withTag(FMT_LIST, list);

  if (typeof CompressionStream !== "undefined") {
    try {
      const deflated = await deflateRaw(bits);
      if (deflated.length + 1 < best.length) best = withTag(FMT_DEFLATE, deflated);
    } catch {
      /* fall back to whatever is smallest so far */
    }
  }
  return bytesToBase64url(best);
}

// Code string -> owned set (of global_index numbers). Maps each stored uid back
// to the current global_index via uidToId (Map<uid, global_index>); uids missing
// from the current master are skipped. Async: may decompress.
export async function decodeOwned(code, uidToId) {
  const set = new Set();
  if (!code || !uidToId) return set;
  let bytes;
  try {
    bytes = base64urlToBytes(code);
  } catch {
    return set;
  }
  if (bytes.length === 0) return set;
  const fmt = bytes[0];
  let bits = bytes.subarray(1);

  const addUid = (uid) => {
    const gi = uidToId.get(uid);
    if (gi !== undefined) set.add(gi);
  };

  if (fmt === FMT_LIST) {
    let acc = 0, val = 0, shift = 0;
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      val |= (b & 0x7f) << shift;
      shift += 7;
      if ((b & 0x80) === 0) { acc += val; addUid(acc); val = 0; shift = 0; }
    }
    return set;
  }
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
    for (let bit = 0; bit < 8; bit++) if (b & (1 << bit)) addUid(i * 8 + bit);
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
    tab: p.get("t") || "",
  };
}

export function buildHash({ ownedCode, seed, resources, tab }) {
  const p = new URLSearchParams();
  if (ownedCode) p.set("o", ownedCode);
  if (seed) p.set("s", seed);
  p.set("r", encodeResources(resources));
  if (tab) p.set("t", tab);
  return "#" + p.toString();
}

export function writeHash(state) {
  history.replaceState(null, "", buildHash(state));
}
