// Regenerate public/data/godfat_bcen.json — the banners, gacha pools and cats
// the site builds roll tables from — from godfat's open data (build/bc-en.yaml
// in https://gitlab.com/godfat/battle-cats-rolls, Apache License 2.0).
//
// A GitHub Actions job (.github/workflows/update-data.yml) runs this every day
// and commits the file when it changed; run it yourself to update it sooner:
//   pnpm update-data                          # download from GitLab
//   pnpm update-data --input bc-en.yaml       # a saved copy
//   ... --output other.json --today 2026-10-24
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Dataset } from "../src/engine/data.js";
import { SOURCE_URL, USER_AGENT, dumps, extract, localToday } from "./godfat-data.mjs";

const { values: args } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string", default: fileURLToPath(new URL("../public/data/godfat_bcen.json", import.meta.url)) },
    today: { type: "string", default: localToday() },
  },
});

async function download() {
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`GitLab answered HTTP ${res.status}`);
  return res.text();
}

const text = args.input ? await readFile(args.input, "utf8") : await download();
const data = extract(text, { today: args.today });
await writeFile(args.output, dumps(data), "utf8");
const upcoming = new Dataset(data).upcoming(args.today).length;
console.log(`Wrote ${args.output}: ${Object.keys(data.events).length} events (${upcoming} upcoming), `
  + `${Object.keys(data.gacha).length} gachas, ${Object.keys(data.cats).length} cats.`);
