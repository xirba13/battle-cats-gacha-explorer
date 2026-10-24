// godfat's game data, cut down to what the site's roll tables need: the
// current events (dates, rates, flags), their gachas' cat lists, and those
// cats' names and rarities, as public/data/godfat_bcen.json (~20 KB). A port
// of the extraction in the old Python server (backend/app/godfat_data.py, in
// git history), checked to write exactly the same file.
//
// Source: build/bc-en.yaml in https://gitlab.com/godfat/battle-cats-rolls
// (Apache License 2.0; the game data in it is PONOS's). It's ~2 MB, mostly
// unit stats, so instead of parsing all of it, it's cut into top-level
// sections and 2-space entries by regex and only the blocks needed are parsed.

import { parse } from "yaml";

export const SOURCE_URL = "https://gitlab.com/godfat/battle-cats-rolls/-/raw/master/build/bc-en.yaml";
export const USER_AGENT =
  "BattleCatsGachaExplorer (godfat data update; https://github.com/xirba13/battle-cats-gacha-explorer)";
// Keep events that ended up to this many days before the data was built, so a
// copy that's a few days old still lists everything running now.
export const KEEP_DAYS = 7;
// godfat's event menu only looks at his 100 most recent events (the last ones
// in the file); older ones with far-off end dates don't show as upcoming
// there, so they don't here either.
export const EVENTS_SHOWN = 100;

const TOP_KEY = /^([A-Za-z_]+):[ \t]*$/gm;
const ENTRY = /^ {2}([^\s:][^:\n]*):[ \t]*$/gm;
const START_ON = /^ {4}start_on:\s*'?(\d{4}-\d{2}-\d{2})/m;
const END_ON = /^ {4}end_on:\s*'?(\d{4}-\d{2}-\d{2})/m;
const ID = /^ {4}id:\s*(\d+)/m;
const SERIES_ID = /^ {4}series_id:\s*(-?\d+)/m;

// Blocks of text by key, in file order: the matches of `re` up to the next one.
function blocks(text, re) {
  const marks = [...text.matchAll(re)];
  const out = new Map();
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    out.set(m[1].replace(/^['"]+|['"]+$/g, ""), text.slice(m.index, end));
  });
  return out;
}

// One "  key:\n    ..." block's value.
const loadEntry = (block) => Object.values(parse(block))[0];

// "YYYY-MM-DD" n days from `day`.
function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Today on this machine, as "YYYY-MM-DD".
export function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function eventEntry(raw) {
  const int = (v) => Math.trunc(Number(v ?? 0));
  const ev = {
    start_on: String(raw.start_on),
    end_on: String(raw.end_on),
    name: String(raw.name ?? "").trim(),
    id: int(raw.id),
    rare: int(raw.rare),
    supa: int(raw.supa),
    uber: int(raw.uber),
  };
  if (raw.legend) ev.legend = int(raw.legend);
  for (const flag of ["guaranteed", "step_up"]) if (raw[flag]) ev[flag] = true;
  if (raw.platinum) ev.platinum = String(raw.platinum); // "platinum" | "legend" | "dl-100m"
  return ev;
}

// Every event's end date as godfat's site shows it: when an event starts
// before the previous event of the same gacha series has ended, that one ends
// the day it starts (CrystalBall#noramlize_end_date_by_series_id!, run when
// his site loads this file). That's how a Platinum Capsule listed "until
// 2030" ends when the next one starts.
function endDates(eventBlocks, gachaBlocks) {
  const series = new Map();
  for (const [key, block] of gachaBlocks) {
    const m = SERIES_ID.exec(block);
    if (m) series.set(key, m[1]);
  }
  const ends = new Map();
  const latest = new Map(); // series -> its latest event so far
  for (const [key, block] of eventBlocks) { // file order, like godfat
    const start = START_ON.exec(block);
    const end = END_ON.exec(block);
    const gachaId = ID.exec(block);
    if (!(start && end && gachaId)) continue;
    ends.set(key, end[1]);
    const s = series.get(gachaId[1]) ?? null; // no series: grouped together, like his nil
    const earlier = latest.get(s);
    if (earlier !== undefined && start[1] < ends.get(earlier)) ends.set(earlier, start[1]);
    latest.set(s, key);
  }
  return ends;
}

// The small dataset from godfat's bc-en.yaml text: events that haven't ended
// more than `keepDays` before `today` (or exactly `onlyEvents`), their gachas,
// and those gachas' cats. Throws on data it can't use.
export function extract(text, {
  today = localToday(),
  keepDays = KEEP_DAYS,
  onlyEvents = null,
  eventsShown = EVENTS_SHOWN,
} = {}) {
  const cutoff = addDays(today, -keepDays);
  const sections = blocks(text, TOP_KEY);
  for (const needed of ["cats", "gacha", "events"]) {
    if (!sections.has(needed)) throw new Error(`godfat data has no '${needed}' section`);
  }
  const eventBlocks = blocks(sections.get("events"), ENTRY);
  const gachaBlocks = blocks(sections.get("gacha"), ENTRY);
  const ends = endDates(eventBlocks, gachaBlocks);
  const recent = new Set([...eventBlocks.keys()].slice(-eventsShown));

  const events = {};
  for (const [key, block] of eventBlocks) {
    if (onlyEvents !== null) {
      if (!onlyEvents.has(key)) continue;
    } else if (!recent.has(key) || !ends.has(key) || ends.get(key) < cutoff) {
      continue;
    }
    events[key] = eventEntry(loadEntry(block));
    if (ends.has(key)) events[key].end_on = ends.get(key);
  }

  const gachaIds = new Set(Object.values(events).map((ev) => String(ev.id)));
  const gacha = new Map();
  for (const [key, block] of gachaBlocks) {
    if (gachaIds.has(key)) gacha.set(key, (loadEntry(block).cats || []).map((c) => Math.trunc(Number(c))));
  }
  const catIds = new Set([...gacha.values()].flat().map(String));
  const cats = new Map();
  for (const [key, block] of blocks(sections.get("cats"), ENTRY)) {
    if (!catIds.has(key)) continue;
    const raw = loadEntry(block);
    const names = raw.name || ["N/A"];
    cats.set(key, [String(names[0]), Math.trunc(Number(raw.rarity))]);
  }

  const byNumber = (map) => new Map([...map].sort((a, b) => Number(a[0]) - Number(b[0])));
  const data = {
    _meta: {
      source: SOURCE_URL,
      license: "battle-cats-rolls is Apache-2.0 (Lin Jen-Shin); game data (c) PONOS",
      built_on: today,
      events_from: onlyEvents === null ? cutoff : null,
    },
    cats: Object.fromEntries(byNumber(cats)),
    gacha: Object.fromEntries(byNumber(gacha)),
    events, // file order: godfat lists them in this order
  };
  validate(data);
  return data;
}

// Refuse a dataset that couldn't possibly be right (format change, empty
// download...), so a bad update never replaces a good one.
export function validate(data) {
  const events = Object.values(data.events || {});
  if (!events.length) throw new Error("godfat data: no current events");
  if (!Object.keys(data.cats || {}).length) throw new Error("godfat data: no cats");
  const missing = new Set(events.map((ev) => String(ev.id)).filter((id) => !Object.hasOwn(data.gacha || {}, id)));
  if (missing.size && missing.size === events.length) throw new Error("godfat data: no event has its gacha");
}

// JSON with one entry per line, so data updates diff readably in git.
export function dumps(data) {
  const one = (v) => JSON.stringify(v);
  const parts = ["{", `"_meta":${one(data._meta)},`];
  ["cats", "gacha", "events"].forEach((section, i) => {
    const items = Object.entries(data[section]);
    parts.push(`"${section}":{`);
    items.forEach(([k, v], j) => parts.push(`${one(k)}:${one(v)}${j < items.length - 1 ? "," : ""}`));
    parts.push(`}${i < 2 ? "," : ""}`);
  });
  parts.push("}");
  return `${parts.join("\n")}\n`;
}
