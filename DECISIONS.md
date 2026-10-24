# Decisions & Assumptions

Running log of non-obvious decisions, assumptions, and findings made while
building the Battle Cats Gacha Explorer.

## Webapp pivot (stateless, deployable)

The `webapp` branch refocuses the project as a deployable web app that **stores
nothing**:

- **No database, no uploads.** The SQLite persistence, the followed-path history,
  and the screenshot-import feature (and its OpenCV dependency) were removed. The
  backend is now a small **stateless** FastAPI service: `search` and `followed`
  take the player's state (owned units, seed, resources) in the request and
  return the new state; nothing is written to disk.
- **State lives in the URL.** Owned units are a bitmask stored as
  `[format byte][payload]` → URL-safe base64 (`frontend/src/owncode.js`), keyed
  on each unit's **stable in-game id** (`uid`), not its Cat Guide display
  position (`global_index`) — see "Stable uid" below. We keep whichever payload
  is smallest: `0x01` raw (trailing-trimmed), `0x02` raw-deflate via the
  browser-native `CompressionStream` (no dependency; async), or `0x03` a
  sorted-delta LEB128 list. Dense dexes deflate to a handful of chars; sparse
  collections (and the high-uid eggs) favour the varint list; pick-smallest means
  it's never worse than the ~124-char raw. The runtime keys on `global_index`
  everywhere else, translating to/from `uid` only at this URL boundary (App.jsx
  builds the maps from the master). Seed and resources ride along uncompressed in
  the hash (`#o=<code>&s=<seed>&r=a.b.c.d`). The URL *is* the save file
  (copy-link / copy-code / load-code).
- **Stable uid (insertion-safe).** `global_index` is the Cat Guide display order,
  which **renumbers when a unit is inserted mid-guide** — so keying the URL
  bitmask on it would silently corrupt every shared link on the next master
  update. Instead `uid` is the in-game unit id (the `UniNNN` in the icon
  filename), which only grows as units are released. The 24 Ancient Eggs share
  one placeholder icon (`Uni000_m00`) so they have no distinct `UniNNN`; they get
  `uid = 100000 + <name N-code>` (a reserved block real ids won't reach).
  `scrapers/update_cat_guide.py` derives `uid` per unit and asserts uniqueness.
  The bitmask spans only up to the highest owned uid, and decode skips uids
  absent from the current master, so new (higher-uid) units read as not-owned in
  old codes and retired units are dropped. The format byte leaves room for future
  schemes without breaking old links.
- **godfat cache is in-memory.** `GodfatClient(cache_dir=None)` uses a size-capped
  RAM LRU instead of disk, so the server is fully stateless. It's server-side, so
  it never affects client performance; it persists for the server's lifetime.
- **Auto seed-fill.** godfat encodes the *resulting* seed in each cat's name-link
  `href` (`seed=...`). `parse_tables` captures it per cell, the search threads it
  into `Action.result_seed` / `Solution.final_seed`, and "I followed this path"
  returns it so the UI fills in the next seed automatically (verify on godfat).
- **Track table (results view, like the normal-gacha explorer).** `/api/search`
  also returns each banner's parsed roll table (`banners[].rolls`, without the
  seeds), every unit's rarity (`units`), and per solution the cells each action
  pulls (`cells`, from `pathfinder.solution_cells`): a single pull is one cell,
  an 11-roll eleven, a guaranteed 11-draw its ten normal pulls plus the
  guaranteed column of its start row. `solution_cells` walks the path with the
  same rules as `verify_solution`, and a test reads every cell back from the
  table and checks it gives exactly the units the action pulled. The frontend
  draws godfat-style A/B tracks: one column per banner, plus an "11-draw"
  column on guaranteed banners (user choice: godfat style rather than an extra
  line in the cell). The selected path is shaded (only the result it gets when
  a cell has a dupe line), the end position is striped, and only the rows near
  the screen are drawn (fixed 19 px half-rows), so a 1000-deep table stays
  light. Cells are for looking only (user choice); "I followed this path" stays
  the way to update seed, units and resources. The results list shows only each
  path's title (targets and cost) except for the selected path, which also
  shows its steps and the "I followed this path" button (user request);
  clicking a title selects that path and keeps the title where it was on
  screen.

## Local roll tables (no scraping)

Roll tables are computed by the app instead of scraped from bc.godfat.org, so
his site being slow or down doesn't matter (user request). `BCPE_SOURCE=godfat`
switches back to scraping (`godfat.py`, unchanged).

- **Engine (`backend/app/rolls.py`).** A Python port of godfat's roll logic
  (battle-cats-rolls `gacha.rb`, `gacha_pool.rb`, `cat.rb`; Apache-2.0: licence
  in `LICENSES/`, attribution and the list of changes in the file header).
  xorshift32 (13/17/15), advanced once before row 1; row n of track A reads
  seeds s[2n−1] (rarity) and s[2n] (slot), track B s[2n] and s[2n+1]. Rarity is
  `seed % 10000` against the event's rare/supa/uber rates (legend gets the
  rest); the cat is `seed % len(slots)` in the gacha's cat list filtered by that
  rarity. Dupe: only a Rare cat equal to the previous cat; it re-picks from a
  copy of the slot list without that slot, one seed step per re-pick, and lands
  at `row + (track+steps)//2 + 1` on track `((track+steps−1)^1)&1`. Guaranteed:
  follow the pull chain 10 times; the 11th position's rarity seed picks the
  uber, and you land at `sequence − (track^1)` on the other track. Every cell
  and every dupe cell gets one (the dupe one is what an 11-draw starting there
  gives when its first pull is a dupe). The seed after a pull is that cat's slot
  seed, the value godfat puts in each cat's link, so auto seed-fill still works.
  The output is the same per-position dict `parse_tables` reads from godfat's
  HTML, so the search, track table and seed-fill didn't change. A 1000-row
  guaranteed banner takes ~12 ms (a godfat page takes seconds).
- **Validated cell for cell.** `test_rolls.py` rebuilds the five tables in the
  scraped fixture (four guaranteed banners and a Legend Capsule; the seed is
  recovered from 1A's link by stepping xorshift back twice) and compares every
  value: 1,400 cells / 6,268 values, including 20 dupe cells, 20 dupe-first
  guaranteed cells and 1,116 guaranteed cells. All match; the only differences
  were two cats godfat has renamed since (Amakusa Shiro → Shiro Amakusa,
  Terun → Huntress Terun), mapped in the test. Also checked against his live
  site on 2026-10-23: six current tables (Platinum Capsule, Legend Capsule, a
  guaranteed banner, three normal ones; 360 cells) were identical.
- **Data (`backend/app/godfat_data.py`, `data/godfat_bcen.json`).** From
  godfat's `build/bc-en.yaml` on GitLab. Parsing the whole ~2 MB file takes ~7 s
  and peaks at ~100 MB (too much for the free-tier server), and it's mostly unit
  stats. So it's split into top-level sections and 2-space entries by regex and
  only the blocks needed are parsed: events that ended at most 7 days ago, their
  gachas, and those gachas' cats (first-form name + rarity): ~1 s and ~8 MB on
  top of the text (a whole refresh, download included, ~3 s and ~26 MB at
  peak), giving ~20 KB of JSON, written one entry per line so updates diff
  readably. godfat's cat ids are the master uid + 1, and all of them map to Cat
  Guide names.
- **Upcoming list = godfat's.** First the end dates, as his site fixes them
  when it loads this file (`noramlize_end_date_by_series_id!`): an event that
  starts before the previous event of the same gacha series has ended ends that
  one on its start day. That's how a Platinum/Legend Capsule listed "until 2030"
  ends when the next one starts. Then, among his 100 most recent events (the
  last ones in the file, like his menu), the ones running now (start < today ≤
  end), then the ones starting later (today ≤ start), in file order. Checked
  against his live menu on 2026-10-23: the same 13 banners, order and dates
  (without the end-date rule we listed 17, without the 100-event window 123).
  Banner type from his flags: `platinum: platinum` → Platinum Capsule,
  `platinum: legend` → Legend Capsule, anything else (incl. `dl-100m`) normal.
  A gacha with a cat missing from the data has an empty pool, as on godfat;
  that banner is skipped ("no cats in this gacha").
- **Refresh.** The shipped JSON is loaded at start; a daemon thread downloads
  the YAML every `BCPE_DATA_REFRESH_HOURS` (default 12, 0 = off) with
  `If-None-Match` (ETag), extracts it and swaps the dataset in one assignment.
  Any failure (network, HTTP error, a format change caught by `validate`) is
  logged and the current data kept. In memory only, so the server stays
  stateless; `scrapers/update_godfat_data.py` regenerates the shipped copy.
- **Step-up banners** (15-draw guarantee) get no guaranteed column: the search
  only plans 11-draws, so it would plan wrong ones. They're searched as normal
  banners for now.
- **Two search fixes found while validating (both sources).** (1) An 11-draw
  whose first pull is a dupe of the previous cat starts on the dupe line, so its
  uber and landing are the dupe cell's guaranteed values (`alt_guaranteed_*`),
  not the cell's; `guaranteed_for()` picks the right one in the search,
  `verify_solution` and the track-table cells. (2) On a guaranteed banner every
  11-draw is guaranteed; where the table has no guaranteed cell (its last ~10
  rows) the search used to plan a plain 11-roll, which can't happen in-game. Now
  it plans none there.
- **Limits.** Tables are now built per request, so depth is capped at 1000 rows
  (`MAX_COUNT`, as in the UI), and a seed that isn't a number from 0 to 2³²−1 is
  a 400.

## M1 — Pathfinder library

- **Module layout.** `test2.py` became `backend/app/pathfinder.py`. The global
  config (DATA_FILE, BANNER_LIMITS, TARGET_UBERS, MODE, MAX_*) was removed; all
  of it is now passed into `find_paths(...)`. The dead "salvage unpacking"
  blocks from the upstream script (defensive `len(state)==9` handling) were
  dropped — the state tuple is now fixed-shape.
- **4-resource vector.** Resources are `(rare_tickets, cat_food,
  platinum_tickets, legend_tickets)` in `RESOURCE_KEYS` order. Pareto domination
  generalised from 2D to this 4D vector: a state is dominated iff some already-
  seen vector is `<=` it in *every* component.
- **Pull cost model.** A normal/rare single pull branches into two successor
  states — one paying `1 rare_ticket`, one paying `150 cat_food` — so the Pareto
  frontier keeps both the ticket-cheap and food-cheap paths. A guaranteed
  11-draw costs `1500 cat_food`. Confirmed against godfat's standard rates
  (1 pull = 1 rare ticket or 150 food; 11-draw track = 1500 food).
- **Platinum / Legend banners.** Modelled as `Banner.type`. Each is a sequence
  of single guaranteed pulls costing exactly **1 platinum/legend ticket**;
  **no 11-draw**, no cat food, no rare tickets. `banner_limits[idx]` is auto-set
  to the player's ticket count for that currency, and a banner with 0 tickets is
  excluded (limit 0 ⇒ never expanded). The position still advances by 1 per pull
  and uses the same duplicate/track logic, because godfat renders these as
  ordinary roll tables.
- **Heap priority vs. correctness.** The min-heap orders by
  `(-collected_count, scalarised_cost, *resource_vector)` where tickets are
  weighted by their cat-food-equivalent. This only affects *exploration order*;
  optimality is guaranteed by Pareto domination in the visited set, not the
  scalar. So the rough scalar weighting is safe.
- **Structured output.** `find_paths` returns `Solution` objects (list of
  `Action`s with `banner_index, action_type, payment, position_from/to,
  units_pulled, targets_hit, cost`, plus total `cost`, `final_position`,
  `collected_count`, `collected_units`) — not markdown.
- **Verification.** `path_checker.py`'s re-simulation logic is ported into
  `verify_solution(banners, solution)` and asserted in the test suite: every
  solution `find_paths` returns is re-walked from `1A` and must reproduce the
  same units and positions. This is the experimental-tool safety net.
- **Experimental disclaimer.** Upstream marks the tool as not fully tested; the
  UI must show a "sanity-check on godfat before spending" disclaimer (M6).

### Mechanics refinements (post-M1)

- **Plain 11-roll on non-guaranteed banners.** On a banner whose godfat
  *Guaranteed* columns are empty (not a guaranteed-uber event), an 11-roll is
  simply **11 consecutive normal pulls for 1500 cat food** (the 11th is the free
  bonus — no guaranteed uber). The search now offers this `multi_11` action
  whenever a normal banner position has no `guaranteed_unit` and 11 pulls can be
  simulated; the landing position is computed by following the normal chain 11
  times (so duplicate-rare track switches are honoured). Guaranteed banners keep
  the `guaranteed_11` action (10 normal + the guaranteed uber). Both cost 1500
  cat food and cannot be paid with tickets.
- **Single pulls: rare tickets first, then cat food.** A single pull no longer
  branches into a ticket-vs-food choice. While the player still has rare tickets
  (`tickets_used < rare_tickets budget`) a single pull **must** spend a ticket;
  only once tickets are exhausted do single pulls cost 150 cat food. This
  reflects how the resource is actually spent (tickets are the "free" currency)
  and is enforced deterministically per search state, so a path's ticket/food
  split is fixed by how many singles precede it. (11-rolls are unaffected —
  always cat food.)
- **Paths end at the last target.** Targets are *all* not-owned units in the
  selected banners (often dozens), but usually only a few are actually
  reachable. Since the search rarely collects the entire set, it keeps exploring
  past the best-reachable count, generating count-N states padded with trailing
  pulls that collect non-targets. `_build_solutions` therefore **trims every
  returned path at its last target-collecting action** (recomputing cost and
  final position from the trimmed path) and de-duplicates the results — distinct
  routes that padded to the same prefix collapse into one. Pre-target actions
  (e.g. an 11-roll used purely to advance the seed so a Legend pull lands on the
  wanted uber) are kept; only post-last-target waste is removed.

## M2 — godfat ingestion

- **URL scheme (verified against the live page, not assumed).** The base page
  `https://bc.godfat.org/?seed=SEED` contains a `<select id="event_select"
  name="event">` whose options *are* the event list. It has three optgroups:
  `label="Upcoming:"`, `label="Custom:"`, `label="Past:"`. We parse only the
  **Upcoming** optgroup. Each `<option value="2026-05-29_947">` carries the
  godfat event id; the option text is `"YYYY-MM-DD ~ YYYY-MM-DD: Description"`.
  A specific banner's roll table is fetched at
  `https://bc.godfat.org/?seed=SEED&event=EVENT_ID&count=N`.
- **`count`.** Number of seed-track rows rendered. Higher = deeper search space
  but slower page. Default `count=100` (plenty for typical targets; an 11-draw
  needs only +11 rows). Configurable per request.
- **One banner = one roll table.** A single-event fetch renders one roll
  `<table>` with `pick('NA')` cells. `parse_tables` keeps only tables that
  contain pick cells, so layout/other tables are ignored. (The bundled
  `data.txt` fixture concatenates several banners → 5 tables; the parser handles
  N transparently.)
- **Special-banner detection (by option text).** Platinum Capsules matched on
  `"100% Uber drop Rate in the PLATINUM CAPSULES"`; Legend Capsules on
  `"Guaranteed Uber or Legend Rare from the Legend Capsules"`. These map to
  `Banner.type` platinum/legend.
- **Good citizen (godfat sends `robots: none`).** All fetches go through
  `GodfatClient`: a descriptive User-Agent, a minimum inter-request interval
  (rate limiting), exponential backoff on 429/5xx, and an on-disk cache keyed by
  `(seed, event_id, count)`. Roll tables for a given seed are immutable, so they
  cache indefinitely; the per-seed event list uses a short TTL.
- **Name normalisation.** `names.NameMatcher` matches godfat unit names to the
  master Cat Guide names: lowercased, HTML-unescaped, apostrophes removed
  (`Li'l`→`lil`), `&`→`and`, punctuation collapsed to spaces. Unmatched godfat
  names are logged to `unmatched_names.log` (and returned) for manual
  reconciliation rather than being silently dropped.

## M3/M4 — Persistence, API, UI

- **Owned state keyed by (region, global_index)** so the master list stays
  region-swappable. Resources/seed/region live in a `settings` k/v table.
- **Targets are godfat names, not master names.** The pathfinder matches target
  strings against the unit names in the roll tables (which are godfat's spelling),
  so `compute_targets` keeps the godfat name as the target and only uses the
  master match to decide ownership. Unmatched godfat names are treated as
  candidate targets (can't confirm ownership) and logged.
- **Banner selection over auto-fetch-all.** godfat pages are very slow (observed
  ~30–60 s each). Fetching all 30+ upcoming banners per search would take many
  minutes and hammer godfat. So `/api/events` returns the list cheaply (one
  cached page) and the UI lets the user pick which banners to actually fetch and
  search; special banners are pre-selected when the player has the tickets.
- **Followed-path workflow.** `apply_followed_path` marks *every* unit pulled
  along the path owned (the full draw, not just targets), decrements resources by
  the solution cost, clears the now-spent seed, and records history. The UI then
  discards all displayed paths and prompts for the new seed — mirroring godfat's
  re-pull-then-re-read-seed loop.

## M5 — Screenshot detection

- **Classify, don't identify.** We never recognise *which* cat is in a cell —
  `(page, slot)` already determines the unit. We only classify locked vs
  unlocked, which is robust and resolution-independent.
- **Grid detection (no hardcoded pixels).** Tiles are low-saturation (white/gray)
  squares on a high-saturation teal background; we mask `S<70 & V>110`, close the
  dark cat-art into solid blobs, and take square contours near the median size.
  Validated on two real screenshots at different resolutions/aspect ratios
  (1280×720 and 2048×921).
- **Largest connected grid component.** Detected boxes are connected into
  row/column neighbours (≈1.6 tile-widths apart, aligned on the other axis); the
  largest component is the grid. This cleanly drops isolated UI elements (Filter/
  Select buttons, page arrows, the cat-food icon) that otherwise dragged the grid
  origin off. (An earlier pitch+phase-fit lattice approach was abandoned because
  a stray button happened to align to the lattice and inflated the bounds.)
- **Gap-aware row/column indexing.** Cluster centres along each axis, derive the
  pitch from the median adjacent gap, and index by `round((centre-first)/pitch)`
  so a missing interior tile doesn't shift the numbering. Handles partial pages
  (e.g. Normal = 10 units) naturally — absent tiles are just absent.
- **Locked vs unlocked.** Sample the cell interior (shrunk to avoid the border):
  a locked "?" box is near-uniform gray (low brightness std `<42`); unlocked art
  has high variance. An `empty` class (high saturation *and* very low std) guards
  the rare lattice-sampling path. Verified: the two "?" tiles in the full-page
  sample classify as locked; all others unlocked.
- **Human-in-the-loop.** Detection is an accelerator: results are shown for
  confirmation and applied to owned-state in bulk, then the user fixes any
  mistake with one click in the Cat Guide. ~90%+ accuracy on the samples
  (10/10 and 23/24 tiles, locked tiles correct).

## M6 — Packaging & polish

- **Packaging.** `docker compose up --build` runs both services (backend on
  8000, frontend dev server on 5173 proxying `/api` to the backend service).
  `backend/var/` is a mounted volume so the SQLite DB + godfat cache persist. A
  `Makefile` wraps the common commands for non-Docker local dev.
- **Region-swappable master list.** `master.discover_regions()` scans
  `backend/data/` for `cat_guide_master*.json`; each file's `_meta.region` shows
  up in the top-bar region selector, and owned-state is stored per region.
- **Re-scrapers.** `scrapers/scrape_godfat.py` (banners) reuses the app's polite
  cached client; `scrapers/update_cat_guide.py` (master list) regenerates the
  region JSON from the wiki. Console output is forced to UTF-8 since godfat
  descriptions contain `★`/`→` that crash the default Windows code page.
- **Line endings.** `.gitattributes` normalises text to LF and marks images/
  sqlite binary.
- **Verification status.** The backend is fully built, run, and tested (38
  passing tests; live godfat ingestion + the re-scraper exercised against the
  real site). The React frontend is written but was **not** runtime-verified in
  this environment because neither Node/pnpm nor a running Docker daemon was
  available; it should be smoke-tested with `docker compose up` (or local
  `pnpm dev`) on a machine that has them.
