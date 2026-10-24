// The player's wishlists: the units they want (stable uids, most wanted
// first), each list with its own ranking for the Path Finder, and each unit
// ticked or not for the search. The open list is the one the Wishlist tab
// shows and the Path Finder searches (unless it's set to every unit you
// don't own).
//
// All the lists are saved in the page URL and this browser as one code. One
// list can also travel alone (a wishlist link or code): opening it adds an
// exact copy of it to the other person's lists, next to theirs.
import { ByteReader, ByteWriter, base64urlToBytes, bytesToBase64url } from "./bytes.js";

// Which paths the Path Finder prefers for a list (pathfinder.js's RANK_*).
export const RANKINGS = [
  {
    id: "order",
    label: "Top of the list first",
    help: "A path with your #1 always beats one without it, even if the other gets more units; then #2 decides, and so on.",
  },
  {
    id: "most",
    label: "Most units",
    help: "The path with the most of these units wins, whichever they are; between paths with as many, the cheaper " +
      "one, and then the one with units higher on your list.",
  },
];
export const DEFAULT_RANKING = "order";
export const DEFAULT_NAME = "My wishlist";
export const MAX_NAME = 40;

export const cleanName = (name) => String(name ?? "").trim().slice(0, MAX_NAME) || DEFAULT_NAME;
export const newList = (name = DEFAULT_NAME) => ({ name: cleanName(name), ranking: DEFAULT_RANKING, units: [] });
// The Path Finder's choices are kept with the lists: `every`, it searches
// every unit you don't own instead of the open list; `keepLegends`, its paths
// never skip a Legend Rare.
export const emptyWishes = () => ({ lists: [newList()], open: 0, every: false, keepLegends: false });

// ---- one list (each returns a new list) ---------------------------------- //

export const hasUnit = (list, uid) => list.units.some((u) => u.uid === uid);
// Added at the end (least wanted), ticked.
export const withUnit = (list, uid) => (hasUnit(list, uid) ? list : { ...list, units: [...list.units, { uid, on: true }] });
export const withoutUnit = (list, uid) => ({ ...list, units: list.units.filter((u) => u.uid !== uid) });
export const withTick = (list, uid, on) => ({ ...list, units: list.units.map((u) => (u.uid === uid ? { ...u, on } : u)) });
export const withAllTicked = (list, on) => ({ ...list, units: list.units.map((u) => ({ ...u, on })) });
export const withRanking = (list, ranking) => ({ ...list, ranking });

// The unit at `from` moved to `to` (both places in the list).
export function moved(list, from, to) {
  const units = [...list.units];
  const [u] = units.splice(from, 1);
  units.splice(Math.max(0, Math.min(units.length, to)), 0, u);
  return { ...list, units };
}

// Same units, ticks and ranking (whatever the names).
const sameContent = (a, b) =>
  a.ranking === b.ranking && a.units.length === b.units.length &&
  a.units.every((u, i) => u.uid === b.units[i].uid && u.on === b.units[i].on);
const sameList = (a, b) => a.name === b.name && sameContent(a, b);

// `name`, or "name (2)", "name (3)"… if a list already has it.
function freeName(name, lists) {
  const taken = new Set(lists.map((l) => l.name));
  for (let n = 2; taken.has(name); n++) name = cleanName(`${name.replace(/ \(\d+\)$/, "").slice(0, MAX_NAME - 6)} (${n})`);
  return name;
}

// ---- all the lists (each returns new wishes) --------------------------- //

export const openList = (w, i) => ({ ...w, open: i, every: false });
export const setEvery = (w, every) => ({ ...w, every });
export const setKeepLegends = (w, keepLegends) => ({ ...w, keepLegends });
export const changeOpen = (w, fn) => ({ ...w, lists: w.lists.map((l, i) => (i === w.open ? fn(l) : l)) });
export const addList = (w, list) => ({ ...w, lists: [...w.lists, list], open: w.lists.length, every: false });

// Deleting the last list leaves an empty one.
export function deleteList(w, i) {
  const lists = w.lists.filter((_, k) => k !== i);
  if (!lists.length) return emptyWishes();
  return { ...w, lists, open: Math.min(w.open > i ? w.open - 1 : w.open, lists.length - 1) };
}

// A shared list: added as an exact copy (numbered if its name is taken) and
// opened, unless a list with the same units, ticks and ranking is already
// there (then that one is opened). With nothing but the empty starting list,
// the copy takes its place. {wishes, added, name}.
export function importList(w, list) {
  const copy = { ...list, units: list.units.map((u) => ({ ...u })) };
  if (isEmpty(w)) return { wishes: { ...emptyWishes(), lists: [copy] }, added: true, name: copy.name };
  const same = w.lists.findIndex((l) => sameContent(l, list));
  if (same >= 0) return { wishes: openList(w, same), added: false, name: w.lists[same].name };
  const name = freeName(list.name, w.lists);
  return { wishes: addList(w, { ...copy, name }), added: true, name };
}

// The lists holding any of `uids`: [{index, name, uids}] (after you pulled
// them, to offer taking them off).
export function listsWith(w, uids) {
  const set = new Set(uids);
  return w.lists
    .map((l, index) => ({ index, name: l.name, uids: l.units.filter((u) => set.has(u.uid)).map((u) => u.uid) }))
    .filter((x) => x.uids.length);
}

export const removeEverywhere = (w, uids) => {
  const set = new Set(uids);
  return { ...w, lists: w.lists.map((l) => ({ ...l, units: l.units.filter((u) => !set.has(u.uid)) })) };
};

// ---- codes ---------------------------------------------------------------- //
// base64url of: a format byte, then for all the lists the open one, flags
// (1 = every unit, 2 = never skip a Legend Rare) and the lists; for one list
// just that list. A list: its name, ranking (a byte), then each unit as
// uid * 2 + (unticked ? 1 : 0).

const FMT_ALL = 1;
const FMT_ONE = 2;
const RANK_CODES = RANKINGS.map((r) => r.id);

function writeList(out, list) {
  out.text(list.name).byte(Math.max(0, RANK_CODES.indexOf(list.ranking))).uint(list.units.length);
  for (const u of list.units) out.uint(u.uid * 2 + (u.on ? 0 : 1));
}

// Units this Cat Guide list doesn't know (`known`: a Set of uids) are left out.
function readList(r, known) {
  const name = cleanName(r.text());
  const ranking = RANK_CODES[r.byte()] ?? DEFAULT_RANKING;
  const units = [];
  const seen = new Set();
  for (let n = r.uint(); n > 0; n--) {
    const v = r.uint();
    const uid = Math.floor(v / 2);
    if (seen.has(uid) || (known && !known.has(uid))) continue;
    seen.add(uid);
    units.push({ uid, on: v % 2 === 0 });
  }
  return { name, ranking, units };
}

const isEmpty = (w) =>
  w.lists.length === 1 && w.open === 0 && !w.every && !w.keepLegends && sameList(w.lists[0], newList());

// All the lists -> code ("" when there's nothing but an empty list).
export function encodeWishes(w) {
  if (isEmpty(w)) return "";
  const flags = (w.every ? 1 : 0) | (w.keepLegends ? 2 : 0);
  const out = new ByteWriter().byte(FMT_ALL).uint(w.open).byte(flags).uint(w.lists.length);
  for (const l of w.lists) writeList(out, l);
  return bytesToBase64url(out.toBytes());
}

// Code -> all the lists (empty ones for "" or a broken code).
export function decodeWishes(code, known = null) {
  if (!code) return emptyWishes();
  try {
    const r = new ByteReader(base64urlToBytes(code));
    if (r.byte() !== FMT_ALL) return emptyWishes();
    const open = r.uint();
    const flags = r.byte();
    const lists = [];
    for (let n = r.uint(); n > 0; n--) lists.push(readList(r, known));
    if (!lists.length) return emptyWishes();
    return { lists, open: Math.min(open, lists.length - 1), every: (flags & 1) !== 0, keepLegends: (flags & 2) !== 0 };
  } catch {
    return emptyWishes();
  }
}

// One list -> code (a wishlist link or code).
export function encodeList(list) {
  const out = new ByteWriter().byte(FMT_ONE);
  writeList(out, list);
  return bytesToBase64url(out.toBytes());
}

// Code (or a wishlist link holding one) -> one list, or null if it isn't one.
export function decodeList(code, known = null) {
  const m = /[#&]wish=([^&]+)/.exec(code);
  const text = (m ? m[1] : code).trim();
  try {
    const r = new ByteReader(base64urlToBytes(text));
    if (r.byte() !== FMT_ONE) return null;
    return readList(r, known);
  } catch {
    return null;
  }
}
