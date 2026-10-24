// Read roll tables from a saved bc.godfat.org page, for the tests that check
// the engine against godfat's own tables (tests/fixtures/sample_banners.txt).
// A port of the old scraper's parse_tables: one object per <table>, mapping
// "1A", "1B"... to {unit, unit_seed, alt_unit, alt_next, alt_seed,
// guaranteed_unit, guaranteed_next, guaranteed_seed, alt_guaranteed_*}.

const CELL = /<td[^>]*onclick="pick\('([0-9]+)([AB])(R?)(G?)X?'\)"[^>]*>(.*?)<\/td>/gs;
// A cell's first link is the unit's name; its href carries the seed after it.
const NAME = /<a\s+href="([^"]*)"[^>]*>([^<]+)<\/a>/;
const SEED = /seed=(\d+)/;
const NEXT_POS = /(?:<-|->)\s*(\d+[AB])/;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unescapeHtml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

export function parseTables(html) {
  const banners = [];
  for (const table of html.split("<table")) {
    if (!table.trim()) continue;
    const rolls = {};
    for (const [, num, track, isAlt, isGuaranteed, cellHtml] of table.matchAll(CELL)) {
      const text = unescapeHtml(cellHtml);
      const name = NAME.exec(text);
      const unit = name ? name[2].trim() : null;
      if (!unit) continue;
      const seed = SEED.exec(name[1])?.[1] ?? null;
      const next = NEXT_POS.exec(text)?.[1] ?? null;
      const entry = (rolls[`${num}${track}`] ??= {});
      if (isGuaranteed === "G") {
        const prefix = isAlt === "R" ? "alt_guaranteed" : "guaranteed";
        Object.assign(entry, { [`${prefix}_unit`]: unit, [`${prefix}_next`]: next, [`${prefix}_seed`]: seed });
      } else if (isAlt === "R") {
        Object.assign(entry, { alt_unit: unit, alt_next: next, alt_seed: seed });
      } else {
        Object.assign(entry, { unit, unit_seed: seed });
      }
    }
    if (Object.keys(rolls).length) banners.push(rolls);
  }
  return banners;
}
