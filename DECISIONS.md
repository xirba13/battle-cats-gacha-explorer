# Decisions & Assumptions

Running log of non-obvious decisions, assumptions, and findings made while
building the Battle Cats Optimal-Pull Path Tracker.

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
