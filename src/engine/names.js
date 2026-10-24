// Name matching between godfat's unit names and the Cat Guide list. Both
// sides are normalised to a common key, since
// apostrophes, "&" vs "and" and other punctuation don't always agree.

// Explicit aliases for cases normalisation alone can't bridge.
// Key and value are both raw names; both are normalised before lookup.
const MANUAL_ALIASES = {
  // "godfat name": "master Cat Guide name"
};

// The few HTML entities a name could carry (Python's html.unescape knows them all).
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Collapse a unit name to a comparison key.
export function normalize(name) {
  let s = unescapeHtml(name || "").trim().toLowerCase();
  s = s.replace(/[’‘`]/g, "'");
  s = s.replaceAll("&", " and ");
  s = s.replaceAll("'", ""); // Li'l -> lil, D'arc -> darc
  s = s.replace(/[^a-z0-9]+/g, " "); // any other punctuation -> space
  return s.replace(/\s+/g, " ").trim();
}

// Match godfat unit names against the master unit list.
export class NameMatcher {
  constructor(units) {
    this.byNorm = new Map();
    for (const u of units) {
      const key = normalize(u.name);
      if (!this.byNorm.has(key)) this.byNorm.set(key, u);
    }
    this.aliasNorm = new Map(Object.entries(MANUAL_ALIASES).map(([k, v]) => [normalize(k), normalize(v)]));
    this.unmatched = new Set();
  }

  // The master unit for a godfat name, or null (and remember it).
  match(godfatName) {
    let key = normalize(godfatName);
    if (this.aliasNorm.has(key)) key = this.aliasNorm.get(key);
    const unit = this.byNorm.get(key) ?? null;
    if (unit === null) this.unmatched.add(godfatName);
    return unit;
  }
}
