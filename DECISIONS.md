# Decisions & Assumptions

Running log of non-obvious decisions, assumptions, and findings made while
building the Battle Cats Gacha Explorer: the latest changes (several plans,
explaining a path, dupes after any cat, never skipping a Legend Rare,
wishlists, deeper tables, the repo clean-up) first, then the webapp's sections
in the order they happened, then the early
milestones (M1–M6). The app used to have a Python server
(`backend/`): anything below about it, its files or its tests describes how it
worked then; it was removed in the repo clean-up, and it's all in git history.

## Several plans

The user asked to save more than one plan, and to keep the plans for a seed
they've pulled past, marked outdated, rather than drop them.

- **Up to 10 plans**, each with a name (from "Plan 1" on, renamable), in the
  page URL and the browser's copy as before: `p=` holds their codes joined by
  "." (base64url never uses it), and a plan code now ends with its name
  (format 3; older codes still read, getting "Plan N"). Each plan adds about
  150–350 characters to your own link.
- **Outdated** means a plan starts from a seed that isn't your current one:
  you followed a path since, or changed the seed. That's worked out, not
  stored, so going back to that seed makes it current again. Outdated plans
  are kept and shown (greyed, after the current ones), can't be followed, and
  can be removed together.
- **Following** a path takes it off your plans if it's one of them (matched by
  seed, banners and steps, so following the same path from the search results
  counts too); the confirmation says so, and that your other plans for that
  seed will show as outdated.
- **Sharing a plan** sends only that plan (with your collection and
  wishlists); "Copy link for my other devices" carries them all.
- One plan is open at a time (its steps and track table), the newest current
  one at first; a search closes it, as before.

## Explaining a path

The user asked for a short reason under each step ("switch to track B to get
Uber X", "roll here to avoid skipping Legend Rare Y"), to trust and
double-check a plan; behind a button (their choice), remembered.

- **Worked out in the page** (`src/explain.js`) from what the result already
  has (each step's pulls, targets, cells, dupes, the units' rarities), so it
  costs the search nothing and saved plans get it too.
- **The reasons:** 🎯 the targets a step gets (a guaranteed 11-draw's uber
  named as such); ✨ the Legend Rares it pulls (with "Never skip a Legend
  Rare" on: "so it isn't skipped"); 🔀 where each of its track switches leads
  (the next target, or the next switch); ↪ a switch it sets up (the next
  step's first pull dupes the cat it ends on); otherwise ⬇ where it moves you,
  toward which target, one line for a run of such steps.
- **What they don't claim:** intent. The search picks the whole path at once,
  so the honest reason for any step is "part of the cheapest path to these
  targets"; the lines say what a step does and leads to, all of which can be
  checked on the track table. For a step that only moves you on, they don't
  say "any banner would do": the cat it gives can change a later dupe.
- The button's state is a page preference in this browser (`bcge.pref.*`),
  kept only while "Save in this browser" is on (turning that off forgets it),
  and never saved from a shared plan, which saves nothing.

## Dupes after any cat, and the track switches shown

The user asked to make sure the Path Finder accounts for track switches caused
by duplicate Rares, and to show them clearly, to know in advance where one
happens.

- **What already worked:** godfat's dupe rule, a Rare equal to the cat pulled
  just before is rerolled and you jump (to the other track, or two rows down
  the same one after two re-picks), with the last cat known at every pull,
  inside 11-draws too. Best paths go through several: 5 and 7 for two seeds
  on all banners, nearly all inside 11-draws, where a step only showed its
  start and end ("45A → 56B").
- **Gap 1: dupes after another banner's cat.** The tables (like godfat's page)
  only had a dupe line where the cat before it on the same banner's track (or
  a reroll landing there) was the same cat, and the search only rerolled
  there. But the game rerolls after any banner's cat: godfat's own link for a
  cat opens the next table with `last=` that cat (and its seed at 1A), whatever
  event you then pick, and checks that table's first cell against it
  (`fill_cat_links`, `duped?`: same id, a Rare). With banners whose rates
  differ (Lone Moon Lunos's 6470 / 2600 / 900 against the usual 6970 / 2500 /
  500), a row can be a Super Rare on one and a Rare on the other, so the same
  Rare follows from another banner with no dupe line: 0, 28 and 56 such spots
  in 400 rows for three seeds. Example on the recorded data: Stilts Cat on the
  second banner at 7A, then the first banner's 8A (Stilts Cat again, its own 7A
  being Shaman Cat) is rerolled to Archer Cat and jumps to 9B, where the old
  search went on to 9A.
- **The fix:** every Rare cell gets its reroll (`reroll_*`, the same as the
  dupe line, which depends only on the cell: a test checks they're equal
  wherever godfat shows one), used whenever the cell's cat equals the last
  cat. An 11-draw's uber comes from its 11th roll (godfat picks it with that
  cell's rarity seed): every cell of a guaranteed banner gets the uber it would
  give as the 11th (`uber11_*`), so a draw whose first pull dupes another
  banner's cat gets the right one too. A test checks 700+ guaranteed cells
  give godfat's G and RG this way.
- **Gap 2: the first pull.** The cat pulled before the seed wasn't known. Now
  a "Last cat" field in the top bar (a Cat Guide uid in the link, `l=`, and in
  the browser's copy) starts the search from it; "I followed this path" fills
  it in with the path's last cat, and a saved plan keeps it (plan code format
  2, which still reads format 1 codes).
- **Results:** the recorded "guaranteed banners" and "dupe paths" searches
  kept their best paths, but paths further down the list now go through
  dupes after another banner's cat (cheaper ones the old search couldn't
  see), so those two were re-recorded (see the fixture's `_about`); the tests
  compare the Python's tables and results without this app's new cells.
- **Shown:** a path's title lists its switches ("🔀 5 track switches: 1A→2B,
  51B→53A, …"); under each step, each one, with its pull, the cat repeated,
  what you get instead and where you land; the track table outlines them (and
  draws the dupe line where godfat's table has none, or the uber an 11-draw
  then gets); and when the next pull after a path would be one, it says on
  which banners.
- No measurable cost on the search benchmarks (7.6 s, 2.2 s, 13.2 s).

## Never skipping a Legend Rare

The user asked for an option so a path never skips a Legend Rare, even one
that isn't a target, except on the Legend Banner (the Legend Capsule).

- **A Legend Rare spot is shared.** A cell's rarity comes from its position's
  seed and the banner's rates, and every normal banner with a Legend Rare
  leaves it the same top 0.3% (rare + supa + uber = 9970), so they all roll
  one on the same rows, each its own (on the 2026-10-24 banners each has
  exactly one in its pool). The Platinum Capsule (uber 100%) and the "Limited
  Halloween Units" banners (7000 / 2500 / 500: no Legend Rare) give an uber
  there. With the seeds tried, 3–5 such spots per 400 rows, both tracks.
- **So a path skips one by** pulling the Platinum Capsule or a banner without
  a Legend Rare on that spot, or by a guaranteed 11-draw whose uber lands on it
  (godfat picks the uber with the 11th roll's seed, so it replaces that cell).
  A pull there that gives any Legend Rare counts as not skipping it, the
  Legend Capsule's included (it rolls one there too: its rates leave 5%).
- **The Legend Capsule's spots don't count** (user request): about 1 in 20 of
  its cells is a Legend Rare, and pulling them costs Legend tickets.
- **A strict rule in the search** (`noSkip` in `findPaths`: those moves are
  never made; `legendRareSpots` in services.js finds the spots). A target only
  reachable by skipping one isn't offered.
- **It costs nothing measurable** (7.5 s, 2.3 s and 13.1 s on the depth
  benchmarks with it on, 7.5, 2.3 and 13.0 off). A first version looked up
  every pull's position in a Set and was 3–11% slower; but a normal banner
  with a Legend Rare can't skip one (its cell on every spot is its Legend
  Rare), so now only the other banners' few cells on those spots are checked,
  by identity.
- **It changes real results:** on the recorded 2026-10-23 data with seed
  139026851, every banner and 400 rows, the best path skipped the Legend Rare
  at 191B (it pulled Hallowindy on a Halloween banner there); with the option
  it doesn't, and collects 88 units instead of 89. The test case: Mamoluga
  from the Platinum Capsule plus one normal banner is cheapest at 342B (339
  tickets), a Legend Rare spot; with the option it's taken at a later spot
  (353 tickets).
- Kept with the Path Finder's other choices (a flag in the wishlists code), off
  until ticked; Legend Rare pulls are tagged ✨ in a path's steps.

## Wishlists: priorities, several lists, saved and shared plans

The user asked for a wishlist sorted by priority (most wanted first) that
settles conflicts (two ubers on the same row of two banners, or one on track A
and the other on track B), its own tab with its units picked in the Path
Finder, and a way to save and share the wishlist and a chosen path (a link or
a code) to pick up later, on another device, or to send to a friend. Their
choices: each wishlist chooses whether it prefers the paths that get the
units higher on it or just the most units; a shared plan opens read-only; a
shared wishlist gives whoever opens it an exact copy; after following a path,
ask whether to take the wishlist units it pulled off.

- **Two rankings, per list** (`pathfinder.js`: RANK_ORDER, RANK_MOST; with no
  wishlist it's RANK_COUNT, the search as before). The heap gets one more key,
  m: states pop by n, then cost, then m.
  - *Top of the list first* (RANK_ORDER): the more wanted a target, the
    higher its bit in the mask, and n = −mask, so comparing two masks compares
    what the paths collect in priority order. Exact when the search finishes,
    as wishlist searches do. The paths kept all collect the same units (the
    best set), so they're its cheapest routes; untick units to see others.
  - *Most units* (RANK_MOST): n = −count, as without a wishlist, and m = −mask:
    between paths with as many units the cheaper wins, and the order only
    settles equal costs, which is the user's case of two ubers on the same row
    (same pulls, same cost).
  - A first version had three rankings (strict order, most units then order,
    and weighted points); the user meant just these two, so it's simpler.
  - It costs nothing measurable: the golden searches (count) give exactly the
    same results, and the depth benchmarks the same times (7.7 s, 2.3 s,
    13.4 s) and memory.
- **Wishlist units are found by id.** A list keeps Cat Guide uids, and godfat's
  cat id is the uid + 1 (true for all 223 cats in the 2026-10-24 data; a test
  checks every cat whose name matches), which gives the exact name the tables
  use. So names that don't match ("Shiro Amakusa" vs "Amakusa Shiro") don't
  matter for wishlists. The Upcoming list now says which units each banner can
  give (its gacha's cats of a rarity with a chance), for the Wishlist tab's
  filter and the Path Finder's "not in the picked banners".
- **Several lists**, each with a name, a ranking and its units in order, each
  ticked or not for the search (the ticks are saved too). The Path Finder
  searches the open list, or every unit you don't own; with nothing ticked,
  every unit you don't own, as an empty wishlist did before.
- **Saved like everything else**, in the page URL and the browser's copy: `w=`
  holds all the lists as one code (a format byte, then varints: each unit is
  uid × 2 + 1 if unticked), `p=` the plan. The "which one to keep" prompt
  compares them too.
- **A plan is a path that can be built again**: the seed, table depth, its
  banners (event ids, in order), the rare tickets it was planned with (tickets
  pay first, so they decide what each pull costs), its steps (banner + single or
  11-draw, stored as runs), which of the units it pulls were its targets (bits
  over the different units, in first-pull order) and a 32-bit hash of all it
  pulls: 160 characters for a 13-step plan on 5 banners, 343 for a 57-step,
  92-unit one on 11 (the event ids, kept as text, are most of it). Showing it
  replays the steps on today's tables (`replaySteps`, which the search now uses
  for its results too): no search, so it's instant and the same on every
  device. A plan whose
  data changed is flagged ("changed": the hash differs), as is one whose banner
  left the data ("gone") or whose steps don't fit any more ("broken").
- **Sharing.** "Share plan (read-only)" copies the whole link plus `v=1`
  (next to "Copy link for my other devices", the plain link): it opens
  read-only, so nothing is saved in that browser, its saved copy is untouched
  and there's no "which one to keep" prompt, and "Add their wishlist to mine"
  copies the wishlist into its own lists. A wishlist link is `#wish=<code>`
  (the code is also copyable, and pasted in "Add a shared wishlist…"): it loads
  the opener's own data and adds an exact copy (its name numbered if taken; the
  same units, ticks and ranking under any name just open that list), and the
  URL then becomes the normal one, so a reload doesn't add it again.
- **The tabs stay mounted**, hidden, so going to the Wishlist and back keeps the
  Path Finder's banners and results. The track table redraws its rows when its
  size changes (a ResizeObserver): a hidden table has no size.
- Copy buttons show the text to copy by hand when the browser won't let the
  page use the clipboard (the desktop app's built-in browser doesn't).

## Deeper tables: depth follows your resources

The user asked to look deeper now that the search is faster. Measured on the
2026-10-24 banners with 30 rare tickets, 45,000 cat food and 2 + 2 capsule
tickets (364 pulls' worth):

- **The fixed 100-row depth was the limit.** The best paths stopped at row
  101, the bottom of the table, with most resources unspent. At 400 rows, the
  search with every banner and no wishlist found a path collecting 92 units
  instead of 57 (spending 29 tickets + 43,500 cat food); with half the Cat Guide
  owned, 46 instead of 32.
- **More search steps didn't help.** 2.7× and 13× the 1.5M-step cap found
  exactly the same best paths, in 59 s and 134 s and with up to 2.3 GB, so the
  cap stays.
- So the depth is now `autoDepth(resources)`: the pulls they buy (tickets, 11
  per 1500 cat food plus singles with the rest, capsule tickets) plus 20 rows
  for dupe jumps, between 100 and 1000 rows. Typing a depth overrides it, and
  "Auto" goes back.
- **The cost:** searches cover more ground. The biggest (no wishlist) went
  from 8 s to 21 s, reaching the 20 s limit; a three-unit wishlist search from
  0.4 s to 2.2 s, finding the same path.
- **Tried and dropped:** stopping the search a little below the deepest row
  holding a wishlist unit, to keep wishlist searches fast. Wishlist units recur
  all the way down (the capsules hold every uber; Rares repeat everywhere), so
  there was nothing to cut: the extra time is real search over more reachable
  rows, not wandering past the last target.

## Repo clean-up: a static site only

Once the site ran entirely in the browser (see "Serverless" below), the repo
was cleaned up for that (user request):

- **The backend is gone** (`backend/`: the FastAPI app, its Python engine, its
  data copies and tests), with everything only it used: `deploy.yml` (the SSH
  deploy to the OCI server, which its owner shuts down), `docker-compose.yml`,
  the `Makefile`, the frontend's `Dockerfile`, `scrapers/scrape_godfat.py` and
  `verify_owncode.mjs` (an old copy of the owned-code test).
- **The site is at the repo root** (user choice): `src/`, `public/`, `tests/`,
  `index.html`, `package.json`, moved with `git mv` so their history follows.
  Vercel's Root Directory changes from `frontend` to the repo root.
- **The daily data job is Node only** (user choice). `scripts/godfat-data.mjs`
  ports the Python's YAML extraction, with the `yaml` package (a dev
  dependency) for the small blocks it parses; before the Python was deleted it
  wrote byte-for-byte the same file as the Python on godfat's real 2 MB YAML
  for three dates (13, 11 and 3 upcoming banners) and in the specific-events
  mode. `scripts/update-godfat-data.mjs` is the command (`pnpm run
  update-data`).
- **No test lost.** The Python-only tests were ported to JavaScript: the check
  against godfat's saved tables (`rolls.test.mjs`, 6,268 values, read by a port
  of the old HTML parser that gives the same tables), the pathfinder's rules
  (`pathfinder.test.mjs`), the YAML extraction and the Dataset
  (`godfat-data.test.mjs`), and the Cat Guide uid guards, name matching and
  targets (`catalog.test.mjs`). Tests of server-only code (FastAPI, scraping,
  the background refresh) went with it; so did the two that tested the
  Python's private frontier helpers, which the golden searches cover.
- **The golden results stay as recorded** (`tests/fixtures/golden.json`): they
  are the old engine's answers, checked against godfat, and the engine must
  keep matching them. The script that made them needed the Python, so it's in
  git history only.
- **The two Python scripts left** (`scripts/update_cat_guide.py`,
  `scripts/download_icons.py`, run by hand when new units come out) write the
  site's files directly and need only Python's standard library (the icon
  downloader dropped httpx).

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

## Serverless: everything in the browser

The site no longer needs a server (user request): the Cat Guide list and
godfat's banner data are static files, and the roll tables and the path search
run in the browser.

- **A port, checked against the Python.** `frontend/src/engine/` ports
  `rolls.py`, the Dataset/ingest part of `godfat_data.py`, `pathfinder.py`,
  `names.py`, `services.py` and the request handling of `main.py`, with the
  same states, costs, heap order (−targets, scalar cost, resources, push
  counter) and tie-breaks, so it returns the same paths in the same order.
  `tests/fixtures/make_golden.py` runs the Python on frozen data (the Dec 2025
  fixture events and the data shipped on 2026-10-23, plus the part of the Cat
  Guide list they use, all embedded in `golden.json`) and records 141 roll
  tables (5 seeds, every event, one 1000 rows deep), Upcoming lists for 5
  dates, 9 complete search results (every mode, guaranteed banners, dupes,
  capsules, owned units, a 197-target search, nothing affordable…) and 2 "I
  followed this path" results. `tests/engine.test.mjs` requires identical ones
  (SHA-256 of the canonical JSON, after readable summaries). Rerun the script
  after changing either engine on purpose.
- **Faster.** The same searches run 4–6× faster than the Python: a typical
  wishlist search takes 0.4 s in the browser (2.8 s on the old server); the
  worst case (every banner, no wishlist, the 1.5M-step cap) 11.5 s (~60 s).
- **Memory, for phones.** That worst case first peaked at 1.2 GB. It's the same
  search stored more compactly: a path step is only "banner + single or
  11-draw", in two Int32Arrays (the full actions of the few result paths are
  rebuilt by replaying them); a state keeps only the limited banners' pull
  counts (nothing reads the others'); a frontier vector is packed into one
  number when the budgets allow it; the visited key is one flat string, with
  the targets mask as text worked out once per new mask. Now ~230 MB live in
  Node for the worst case (browsers compress pointers, so less), and typical
  searches are tiny. Worth knowing: numbering BigInt masks through a Map made
  it 40× slower, because V8 hashes BigInt Map keys poorly.
- **More than 31 targets** use BigInt masks (a 32-bit number holds 31); a
  search with every unit as a target has ~200.
- **Caps.** The search runs in a Web Worker (one per search, so the page stays
  responsive and shows progress; leaving the tab cancels it) and stops after
  20 s or 2.5M states (1M on devices that report ≤ 2 GB of memory), on top of
  the 1.5M steps the server had. The result then says it stopped early and that
  cheaper paths may exist; the server stopped at 1.5M steps silently.
- **Data.** `public/data/godfat_bcen.json` and `cat_guide_master.json` are
  plain files. A daily GitHub Actions job (`update-data.yml`, 04:23 UTC)
  rebuilds the banner data from godfat's GitLab with
  `scrapers/update_godfat_data.py` and commits it when it changed; Vercel then
  republishes the site. (Pushes made with `GITHUB_TOKEN` don't start other
  workflows, so it never deploys the old server.) The page warns when its copy
  is more than 3 days old. The Cat Guide list still comes from
  `scrapers/update_cat_guide.py`; a test fails while the site's copy differs
  from the backend's.
- **Dates** come from the device: the Upcoming list compares its local date
  with the events', as godfat's site does with its server's.
- **Saved in the browser too** (user request). `src/browserSave.js` keeps the
  same codes as the URL (owned code, seed, resources, tab) plus when they were
  saved, under the localStorage key `bcge.saved.v1`, on every change. With no
  data in the URL, the page restores that copy (and writes it into the URL, so
  Copy link still works). A link with other data asks which one to keep (user
  choice, so an old bookmark can't silently replace the saved collection):
  owned codes are compared by the units they hold, and nothing is saved over the
  browser's copy until the player chooses. "Save in this browser" off forgets
  the copy and stops saving (`bcge.saveOff`). Storage that's blocked or full is
  ignored; the URL still works. Two open tabs: the last change wins.
- **The wishlist wins over owned** (user request): with a wishlist, the
  targets are exactly its units in the picked banners, owned or not (you may
  want another copy); without one, every unit you don't own. The Python
  reference (`services.compute_targets`) follows the same rule so the golden
  results still hold, and a golden search checks it.
- **The backend stayed** at first, as the reference the golden results came
  from, then went in the repo clean-up (above).

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
