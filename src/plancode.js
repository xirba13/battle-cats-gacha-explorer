// Saved plans (engine/services.js planOf, plus a name) as codes, for the page
// URL and this browser. One plan: base64url of a format byte, the seed, table
// depth, rare tickets, the day it was saved, its banners (godfat event ids,
// in order), its steps (as runs of the same step), its target bits, the hash
// of the units it pulls, the cat pulled before it (uid + 1, 0 for none; from
// format 2) and its name (from format 3). Several plans: their codes joined
// by ".", which base64url never uses.
import { ByteReader, ByteWriter, base64urlToBytes, bytesToBase64url } from "./bytes.js";

const FMT = 3;
const DAY = 86_400_000;
const MAX_STEPS = 5000; // far more than any path through 1000-row tables
export const MAX_PLANS = 10;
export const MAX_PLAN_NAME = 40;

const dayNumber = (date) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);
const dateOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);

export function encodePlan(plan) {
  const out = new ByteWriter().byte(FMT).uint(Number(plan.seed)).uint(plan.depth).uint(plan.rareTickets)
    .uint(dayNumber(plan.savedOn));
  out.uint(plan.events.length);
  for (const e of plan.events) out.text(e);
  const runs = [];
  for (const step of plan.steps) {
    const run = runs[runs.length - 1];
    if (run && run[0] === step) run[1] += 1;
    else runs.push([step, 1]);
  }
  out.uint(runs.length);
  for (const [step, n] of runs) out.uint(step).uint(n);
  out.bytes(plan.hits).uint(plan.check).uint(plan.last === null || plan.last === undefined ? 0 : plan.last + 1);
  out.text(plan.name ?? "");
  return bytesToBase64url(out.toBytes());
}

// Code -> plan, or null if it isn't one.
export function decodePlan(code) {
  if (!code) return null;
  try {
    const r = new ByteReader(base64urlToBytes(code));
    const fmt = r.byte();
    if (fmt < 1 || fmt > FMT) return null;
    const plan = { seed: String(r.uint()), depth: r.uint(), rareTickets: r.uint(), savedOn: dateOf(r.uint()) };
    plan.events = [];
    for (let n = r.uint(); n > 0; n--) plan.events.push(r.text());
    plan.steps = [];
    for (let n = r.uint(); n > 0; n--) {
      const step = r.uint();
      const k = r.uint();
      if (plan.steps.length + k > MAX_STEPS) return null;
      for (let i = 0; i < k; i++) plan.steps.push(step);
    }
    plan.hits = r.bytes();
    plan.check = r.uint();
    const last = fmt === 1 ? 0 : r.uint();
    plan.last = last === 0 ? null : last - 1;
    plan.name = fmt >= 3 ? r.text().slice(0, MAX_PLAN_NAME) || null : null;
    const ok = Number(plan.seed) <= 0xffffffff && plan.depth > 0 && plan.depth <= 1000 && plan.events.length > 0 &&
      plan.steps.length > 0 &&
      plan.steps.every((s) => Math.floor(s / 2) < plan.events.length);
    return ok ? plan : null;
  } catch {
    return null;
  }
}

// "Plan N", N one more than the highest such name so far.
export function nextPlanName(plans) {
  const used = plans.map((p) => /^Plan (\d+)$/.exec(p.name ?? "")).filter(Boolean).map((m) => Number(m[1]));
  return `Plan ${Math.max(0, ...used) + 1}`;
}

export const encodePlans = (plans) => plans.map(encodePlan).join(".");

// Code -> plans (broken ones left out, at most MAX_PLANS), each with a name:
// a plan saved before plans had names gets "Plan N".
export function decodePlans(code) {
  const plans = (code ? code.split(".") : []).map(decodePlan).filter(Boolean).slice(0, MAX_PLANS);
  for (const p of plans) if (!p.name) p.name = nextPlanName(plans);
  return plans;
}
