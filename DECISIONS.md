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
