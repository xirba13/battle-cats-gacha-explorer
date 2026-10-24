// godfat's banner data (events, gacha pools, cats) and what the app does with
// it: the Upcoming list and each banner's roll table. The data itself is a
// static file, public/data/godfat_bcen.json, kept current by a daily GitHub
// job (scripts/update-godfat-data.mjs extracts it from godfat's bc-en.yaml).

import * as pathfinder from "./pathfinder.js";
import { LEGEND, MASK, Pool, RARE, SUPA, UBER, buildRolls } from "./rolls.js";

// godfat numbers cats one higher than the game (and the Cat Guide list's uid):
// his cat 619 is the game's unit 618.
export const uidOfCat = (catId) => catId - 1;
export const catOfUid = (uid) => uid + 1;

// Platinum / Legend Capsules use their own tickets (from godfat's flags:
// uber 100% = platinum; uber + legend 100% for a year or more = legend).
export function bannerType(event) {
  if (event.platinum === "platinum") return pathfinder.BANNER_PLATINUM;
  if (event.platinum === "legend") return pathfinder.BANNER_LEGEND;
  return pathfinder.BANNER_NORMAL;
}

// Today on this device, as "YYYY-MM-DD" (event dates are compared as text).
export function localToday(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export class Dataset {
  constructor(data) {
    this.meta = data._meta || {};
    this.cats = new Map(Object.entries(data.cats).map(([k, v]) => [Number(k), [v[0], Number(v[1])]]));
    this.gacha = new Map(Object.entries(data.gacha).map(([k, v]) => [Number(k), [...v]]));
    this.events = { ...data.events }; // file order (keys aren't integers, so it's kept)
    this.rarity = new Map([...this.cats].map(([id, [, r]]) => [id, r]));
  }

  nameOf(cid) {
    return this.cats.has(cid) ? this.cats.get(cid)[0] : "N/A";
  }

  // The cat id of a name in the tables (the first, if two cats share it).
  catIdOf(name) {
    if (!this.idByName) {
      this.idByName = new Map();
      for (const [id, [n]] of this.cats) if (!this.idByName.has(n)) this.idByName.set(n, id);
    }
    return this.idByName.get(name) ?? null;
  }

  // The rarity (RARE…LEGEND) of a name in the tables, or null.
  rarityOf(name) {
    const id = this.catIdOf(name);
    return id === null ? null : this.rarity.get(id) ?? null;
  }

  // godfat's "Upcoming" list: running now, then starting later.
  upcoming(today = localToday()) {
    const ongoing = [];
    const later = [];
    for (const [key, ev] of Object.entries(this.events)) {
      if (today <= ev.start_on) later.push(key);
      else if (today <= ev.end_on) ongoing.push(key);
    }
    return [...ongoing, ...later].map((k) => this.eventInfo(k));
  }

  eventInfo(key) {
    const ev = this.events[key];
    return {
      event_id: key,
      description: ev.name,
      date_start: ev.start_on,
      date_end: ev.end_on,
      banner_type: bannerType(ev),
    };
  }

  // The event's roll table for `seed`, or null if it has no cats.
  banner(seed, eventId, count) {
    const ev = Object.hasOwn(this.events, eventId) ? this.events[eventId] : undefined;
    if (ev === undefined) return null;
    const pool = new Pool(this.rarity, this.gacha.get(ev.id) || [], ev.rare, ev.supa, ev.uber);
    if (!pool.exists()) return null;
    // Step-up's 15-draw guarantee isn't modelled by the search (it plans
    // 11-draws), so step-up banners get no guaranteed column for now.
    const gRolls = ev.guaranteed ? 11 : 0;
    const table = buildRolls(Number(seed) >>> 0, pool, count, gRolls, (cid) => this.nameOf(cid));
    return new pathfinder.Banner(ev.name, table, bannerType(ev), eventId);
  }

  // The cats (godfat ids) the event can give: its gacha's cats of a rarity
  // with a chance, plus the ubers when its 11-draw guarantees one.
  catsOf(eventId) {
    const ev = Object.hasOwn(this.events, eventId) ? this.events[eventId] : undefined;
    if (ev === undefined) return [];
    const pool = new Pool(this.rarity, this.gacha.get(ev.id) || [], ev.rare, ev.supa, ev.uber);
    const chance = {
      [RARE]: ev.rare > 0, [SUPA]: ev.supa > 0, [UBER]: ev.uber > 0 || Boolean(ev.guaranteed),
      [LEGEND]: ev.rare + ev.supa + ev.uber < 10000,
    };
    return [RARE, SUPA, UBER, LEGEND].flatMap((r) => (chance[r] ? pool.slots[r] : []));
  }
}

// A seed as godfat takes it: a whole number from 0 to 2^32 - 1.
export function parseSeed(seed) {
  const text = String(seed ?? "").trim();
  if (!/^[0-9]+$/.test(text) || Number(text) > MASK) {
    throw new Error(`invalid seed "${seed}": expected a number from 0 to ${MASK}`);
  }
  return Number(text);
}

// The banners to search, built for `seed`: the Upcoming list's order (it
// numbers the banners in the results), then anything else asked for. Skips
// what can't be rolled, saying why.
export function ingest(dataset, seed, count, { resources = null, eventIds = null, today } = {}) {
  const seedNumber = parseSeed(seed);
  const res = resources && Object.keys(resources).length ? pathfinder.normalizeResources(resources) : null;
  const events = dataset.upcoming(today);
  const listed = events.map((e) => e.event_id);
  const wanted = new Set(eventIds ?? listed);
  const order = [...listed.filter((e) => wanted.has(e)), ...[...wanted].filter((e) => !listed.includes(e)).sort()];
  const banners = [];
  const skipped = [];
  for (const eventId of order) {
    const ev = Object.hasOwn(dataset.events, eventId) ? dataset.events[eventId] : undefined;
    if (ev === undefined) {
      skipped.push({ event_id: eventId, reason: "unknown event" });
      continue;
    }
    const kind = bannerType(ev);
    if (res !== null) {
      if (kind === pathfinder.BANNER_PLATINUM && res.platinum_tickets <= 0) {
        skipped.push({ event_id: eventId, reason: "no platinum tickets" });
        continue;
      }
      if (kind === pathfinder.BANNER_LEGEND && res.legend_tickets <= 0) {
        skipped.push({ event_id: eventId, reason: "no legend tickets" });
        continue;
      }
    }
    const banner = dataset.banner(seedNumber, eventId, count);
    if (banner === null) {
      skipped.push({ event_id: eventId, reason: "no cats in this gacha" });
      continue;
    }
    banners.push(banner);
  }
  return { seed: String(seed), banners, events, skipped };
}
