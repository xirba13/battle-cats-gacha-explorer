// "Explain the path": a short reason for each step of a path, worked out from
// what the step does and what comes next on the path, all of which the track
// table shows: the targets it gets, the Legend Rares it pulls, where its track
// switches lead, the switch it sets up for the next step, and otherwise where
// it moves you, toward which target. A run of steps that only move you on
// shares one line, on its first step. (The search picks the whole path at
// once, so these say what a step does, not why the search chose it.)

const LEGEND_RARE = "Legend Rare";
const trackOf = (pos) => pos[pos.length - 1];

// Where a dupe at `from` sends you: usually the other track, sometimes
// further down the same one ("switch to track B (50B)", "jump down to 52A").
function jump(from, next) {
  if (!next) return "jump off the table";
  return trackOf(next) !== trackOf(from) ? `switch to track ${trackOf(next)} (${next})` : `jump down to ${next}`;
}

// For each step of `sol` (a search result's path, with its cells and dupes):
// its reasons (strings), or null when an earlier step's line covers it.
// `ranks`: wishlist places by name; `units`: the result's units (their
// rarity); `keepLegends`: the path never skips a Legend Rare.
export function explainPath(sol, { ranks = null, units = {}, keepLegends = false } = {}) {
  const named = (u) => (ranks?.[u] ? `#${ranks[u]} ${u}` : u);
  // Every pull in order: its step and place in it, where, what, and whether
  // it's a target's first pull, a guaranteed uber or a dupe.
  const pulls = [];
  sol.actions.forEach((a, k) => {
    const hits = new Set(a.targets_hit);
    const got = new Set();
    a.units_pulled.forEach((unit, i) => {
      const hit = hits.has(unit) && !got.has(unit);
      if (hit) got.add(unit);
      const uber = a.action_type === "guaranteed_11" && i === a.units_pulled.length - 1;
      pulls.push({ action: k, pull: i + 1, pos: sol.cells?.[k]?.[i]?.pos ?? a.position_from, unit, hit, uber, dupe: null });
    });
  });
  for (const d of sol.dupes || []) {
    const p = pulls.find((x) => x.action === d.action && x.pull === d.pull);
    if (p) p.dupe = d;
  }
  const target = (p) => (p.uber ? `${named(p.unit)} (the uber of the 11-draw from ${p.pos})` : `${named(p.unit)} at ${p.pos}`);
  const after = (i, test) => pulls.slice(i + 1).find(test) ?? null;

  const out = sol.actions.map((a, k) => {
    const mine = pulls.filter((p) => p.action === k);
    const reasons = [];
    const hits = mine.filter((p) => p.hit);
    if (hits.length) {
      reasons.push(`🎯 For ${hits.map((p) => named(p.unit) + (p.uber ? " (its guaranteed uber)" : "")).join(", ")}`);
    }
    const legends = mine.filter((p) => !p.hit && units[p.unit]?.rarity === LEGEND_RARE).map((p) => p.unit);
    if (legends.length) {
      reasons.push(keepLegends
        ? `✨ Pulls ${legends.join(", ")} here, so ${legends.length > 1 ? "they aren't" : "it isn't"} skipped`
        : `✨ Gets ${legends.join(", ")} on the way`);
    }
    for (const p of mine.filter((x) => x.dupe)) {
      const next = after(pulls.indexOf(p), (x) => x.hit || x.dupe);
      const leads = next === null ? "comes after the last target"
        : next.hit ? `leads to ${target(next)}`
        : `is on the way: you switch again at ${next.pos}`;
      reasons.push(`🔀 ${a.units_pulled.length > 1 ? `Pull ${p.pull}'s` : "Its"} ${jump(p.pos, p.dupe.next)} ${leads}`);
    }
    // The next step's first pull dupes the cat this one ends on.
    const first = pulls.find((p) => p.action === k + 1 && p.pull === 1);
    if (first?.dupe) {
      reasons.push(`↪ Sets up a switch: your next pull is ${first.dupe.was} again, rerolled to ${first.dupe.got}, ` +
        `and you ${jump(first.pos, first.dupe.next)}`);
    }
    return reasons;
  });

  // Steps with no other reason only move you on: one line per run of them.
  for (let k = 0; k < out.length; k++) {
    if (out[k].length) continue;
    let end = k;
    while (end + 1 < out.length && out[end + 1].length === 0) end++;
    const lastPull = pulls.findLastIndex((p) => p.action === end);
    const next = after(lastPull, (p) => p.hit);
    out[k] = [`⬇ ${end > k ? `Steps ${k + 1}–${end + 1} move` : "Moves"} you down to ${sol.actions[end].position_to}` +
      (next ? `, toward ${target(next)}` : "")];
    for (let j = k + 1; j <= end; j++) out[j] = null;
    k = end;
  }
  return out;
}
