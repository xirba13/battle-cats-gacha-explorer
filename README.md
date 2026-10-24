# Battle Cats Gacha Explorer

A web app that helps a Battle Cats player find the **most resource-efficient pull
path** to the units they don't yet own, using godfat seed-tracking data.

> ⚠️ **Experimental and not fully tested.** Every path the app shows is
> re-simulated against the roll tables before display, but **always
> check a path on [bc.godfat.org](https://bc.godfat.org/) before spending real
> resources.**

**Runs entirely in your browser** — no server, no accounts, no database. Your
collection lives in the page URL (a compact code), and the roll tables and the
path search are computed on your device. It has three tabs:

1. **Cat Guide** — a wiki-style grid mirroring the in-game Cat Guide order where
   you toggle units owned/not-owned. Includes a name search box, owned/rarity
   filters, and copy-link / copy-code / load-code buttons to save your collection.
2. **Path Finder** — enter your seed + resources; the app builds the roll tables
   of the *Upcoming* banners in your browser (godfat's roll logic and his open
   data, updated daily, so bc.godfat.org being slow or down doesn't matter),
   computes optimal paths to
   the units you don't own yet (each path ends at its last target), shows them on
   a godfat-style **track table**, and offers an **"I followed this path"**
   button that marks every newly pulled unit as owned, decrements your resources,
   and **auto-fills your new seed**.
3. **Instructions** — an in-app usage guide.

## Screenshots

| Cat Guide | Cat Guide — search & filters |
| --- | --- |
| ![Cat Guide](images/cat_guide.png) | ![Cat Guide filtering](images/cat_guide_filtering.png) |
| **Path Finder — pick banners** | **Path Finder — results** |
| ![Banner selection](images/path_finder_banner_selection.png) | ![Path finder results](images/path_finder_results.png) |

## Prerequisites — read this first

- **You must already be seed-tracking.** This app does **not** derive your seed;
  you provide it. You can find it via [bc-seek.godfat.org/seek](https://bc-seek.godfat.org/seek),
  and it's re-filled automatically each time you follow a path.
- **Nothing is stored on or sent to any server.** Your owned units, seed, and
  resources are saved in your browser and encoded in the page URL — bookmark it
  (or copy your code) to keep them for another device.
- **Region / version:** **BCEN (English) only**, unit list current as of game
  **version 15.6.1**. The master list is region-swappable (see
  [Re-scrapers](#re-scrapers)) but other regions aren't bundled yet.

## Your data & privacy

There are no accounts and no server: the page loads static files and computes
everything on your device. Your **owned units, seed, and resources** are encoded
into the page URL (e.g. `…/#o=<code>&s=<seed>&r=…`) and saved in your browser
(localStorage), so:

- Opening the site again in the same browser brings everything back, even
  without the link.
- **Bookmark the page** (or use **Copy link** in the Cat Guide) to save everything
  for another device or browser; **Copy code** saves just your owned-units code,
  and **Load a code…** restores it.
- Opening a link whose data isn't what your browser saved asks which one to keep,
  so an old bookmark or someone else's link can't replace your saved collection.
- **Save in this browser** (Cat Guide) turns the browser's copy off and forgets
  it, e.g. on a shared computer. Private windows don't keep it, clearing site data
  deletes it, and Safari on iPhone drops it after about 7 days without a visit
  unless the site is on the home screen.

## How a typical session goes

1. **Cat Guide** tab — mark what you already own (click tiles; use the search box
   to find units). Copy your link/code to save it.
2. Top bar — enter your **seed** and your **resources** (rare tickets, cat food,
   platinum tickets, legend tickets).
3. **Path Finder** tab — *Fetch Upcoming banners*, tick the banners to search
   (special Platinum/Legend banners are pre-selected when you have the tickets),
   then *Find optimal paths*. The search runs in the background in your browser:
   usually well under a second; a big one (many banners, no wishlist) stops after
   20 s and shows the best paths found so far. The search button locks until you
   change a banner/wishlist. Under the paths, the **track table** shows each searched
   banner's roll table (tracks A and B, plus an 11-draw column on guaranteed
   banners) with the selected path shaded.
4. Pick a path, pull it in-game, then click **"I followed this path."** Every
   unit on that path is marked owned, your resources are decremented, and your
   **new seed is filled in automatically** — verify it on godfat, then search again.

### Pull cost model

- A single pull costs **1 rare ticket**; once your tickets run out, single pulls
  cost **150 cat food** (tickets are always spent first).
- An 11-roll (multi) costs **1500 cat food** — including on non-guaranteed
  banners, where it's just 11 consecutive normal pulls (cat food only).
- **Platinum / Legend Capsule** pulls cost **1 platinum / legend ticket** each
  (single guaranteed pulls; no 11-roll, no cat food/tickets). Excluded if you
  have 0 of that ticket.

## Tests

```bash
cd frontend && pnpm test                              # the browser engine + owned-code (node --test)
cd backend && .venv/Scripts/python.exe -m pytest      # 61 tests of the Python reference engine
```

The browser engine (`frontend/src/engine`) is a port of the Python one, and its
tests check it gives **exactly** the Python's results: `tests/fixtures/golden.json`
holds the Python's roll tables (141 of them), Upcoming lists, nine complete search
results (guaranteed banners, dupes, capsules, every mode, a 197-target search…)
and "I followed this path" results, made by `tests/fixtures/make_golden.py` from
frozen data. Rerun that script after changing either engine on purpose. The
frontend tests also cover the search's time and memory caps, seed checks, the
shipped data, and the URL owned-code (round-trips, and a mid-guide unit
insertion can't shift or falsely-own existing units).

The Python suite covers the pathfinder (4-resource Pareto, platinum/legend mechanics,
tickets-first single pulls, plain 11-rolls on non-guaranteed banners, paths
trimmed to the last target, resulting-seed capture, re-simulation of every
returned solution, and each path's track-table cells), the local roll engine
(five real godfat tables rebuilt cell for cell: 6,268 values including dupes,
guaranteed ubers and seeds), extracting and refreshing godfat's data (a bad
download never replaces good data), godfat scraping (offline via a mock
transport), name normalisation, the stateless service + FastAPI surface
(search → followed), and the master-list `uid` integrity guards.

## Unit icons (offline rendering)

The Cat Guide tiles render from a locally-served icon set in
`frontend/public/icons/` (so the app doesn't hit the wiki CDN on every render,
and works offline). These ~723 icons are **shipped in the repo**. If an icon is
missing locally the UI automatically falls back to the wiki URL.

Regenerate / refresh them (e.g. after swapping the master list for a new region)
with:

```bash
python scrapers/download_icons.py
# or for another region:
python scrapers/download_icons.py --master backend/data/cat_guide_master_<region>.json
```

## Re-scrapers

- **godfat data** (the banners, gacha pools and cats the roll tables are built
  from): `python scrapers/update_godfat_data.py` downloads `build/bc-en.yaml`
  from [godfat's repo](https://gitlab.com/godfat/battle-cats-rolls) and rewrites
  `frontend/public/data/godfat_bcen.json` (`--input bc-en.yaml` reads a saved
  copy). **You don't need to:** a GitHub Actions job
  (`.github/workflows/update-data.yml`) does it every day and commits the file
  when it changed, which republishes the site. Run it by hand (or start the job
  from the Actions tab) to pick up new banners sooner.
- **godfat banners (scraped):** `python scrapers/scrape_godfat.py --seed SEED --list`
  (or `--out banners.json` to dump parsed tables; reuses the app's polite,
  cached, rate-limited client). The app itself only scrapes with
  `BCPE_SOURCE=godfat`; this is handy for comparing with his site.
- **Master Cat Guide list** (region-swappable): `python scrapers/update_cat_guide.py
  --url https://battlecats.miraheze.org/wiki/Cat_Guide --region en
  --game-version 15.6.1 --previous backend/data/cat_guide_master.json --output
  backend/data/cat_guide_master.json` (or, if Miraheze blocks the bot, Save the
  page in your browser and pass it with `--input Cat_Guide.html`). Stable UIDs
  are derived from each unit's game ID, and existing icon fallback URLs are
  retained when passing `--previous`. Then copy it to
  `frontend/public/data/cat_guide_master.json`, the site's copy (a test fails
  while the two differ).

### Updating to a newer game version

When new units release, just re-run the Cat Guide scraper and download the new
icons. **Existing shared codes keep working:** the owned-code is keyed on each
unit's stable in-game `uid` (the `UniNNN` from its icon), not its Cat Guide
position, so newly added units only ever append higher uids and read as
not-owned in old codes — they never shift or falsely-own existing units. (The
`uid` integrity is enforced by `backend/tests/test_master_uid.py`, which fails if
a re-scrape ever breaks the naming convention.)

## Project layout

```
frontend/           # the site: Vite + React, runs entirely in the browser
  src/engine/       # rolls.js (roll tables, port of godfat's logic), data.js (banner data, Upcoming list),
                    # pathfinder.js (path search), names.js, services.js, search.worker.js (runs a search)
  src/api.js        # what the page used to ask the server, answered in the browser
  src/owncode.js    # owned/seed/resources <-> URL code (the "save file")
  src/browserSave.js  # the same state saved in this browser (localStorage)
  src/components/   # Cat Guide, Path Finder, track table, instructions
  public/data/      # godfat_bcen.json (banner data, updated daily) + cat_guide_master.json
  public/icons/     # ~723 unit icons
  public/top_icons/ # top-bar resource icons
  tests/            # engine vs the Python's golden results (fixtures/golden.json, make_golden.py), owned-code, browser saving
backend/            # the old server (FastAPI), no longer used by the site: kept as the
                    # reference the browser engine is tested against, until it's retired
  app/
    pathfinder.py   # search core (4-resource Pareto, platinum/legend, 11-rolls), verify_solution, seed capture, track-table cells
    rolls.py        # roll tables computed locally (port of godfat's roll logic, Apache-2.0)
    godfat_data.py  # godfat's open data: subset of bc-en.yaml, Upcoming list, banners, background refresh
    godfat.py       # scraping bc.godfat.org instead (BCPE_SOURCE=godfat; in-memory cache + rate limit + backoff)
    names.py        # godfat<->master name normalisation / alias layer
    master.py       # region-swappable master loader
    services.py     # targets, search wiring, stateless followed-path
    main.py         # FastAPI app (/api/master, /api/events, /api/search, /api/followed)
  data/cat_guide_master.json   # BCEN unit list (game v15.6.1), keyed by stable uid
  data/godfat_bcen.json        # current banners, their gacha pools and cats (from godfat's bc-en.yaml)
  tests/            # 61 tests + fixtures (sample godfat tables, their events' data, event list)
scrapers/           # godfat data, godfat banners, Cat Guide list, and icon downloader
.github/workflows/  # update-data.yml (daily banner data), deploy.yml (the old server)
LICENSES/           # third-party licences (battle-cats-rolls, Apache-2.0)
DECISIONS.md        # assumptions, how the roll tables are computed, godfat findings, banner mechanics
```

## Deploying

It's a static site: build with `pnpm build` in `frontend/` and serve `dist/`
anywhere (Vercel, Netlify, GitHub Pages, nginx…). No server, no environment
variables. The daily data job's commits republish it on hosts that build on
push (Vercel does). Locally: `cd frontend && pnpm dev`.

**The old server** (`backend/`, FastAPI) isn't needed any more; it still deploys
to its host through `deploy.yml` until it's retired. It works the same as before
(`uvicorn app.main:app`; `BCPE_DATA_REFRESH_HOURS` sets how often it refreshes
godfat's data, `BCPE_SOURCE=godfat` makes it scrape bc.godfat.org instead).
`docker compose up` runs it next to the site's dev server.

See [DECISIONS.md](DECISIONS.md) for how the roll tables are computed, the
reverse-engineered godfat URL scheme, banner-mechanic confirmations, and other
non-obvious choices.

## License

Released into the **public domain** under [The Unlicense](LICENSE) — do whatever
you like with it, no attribution required.

Except `frontend/src/engine/rolls.js` and `backend/app/rolls.py`: they're ports
of the roll logic in godfat's
[battle-cats-rolls](https://gitlab.com/godfat/battle-cats-rolls) (Copyright Lin
Jen-Shin) and stay under the [Apache License 2.0](LICENSES/battle-cats-rolls-LICENSE.txt).
The banner data in `frontend/public/data/godfat_bcen.json` (and the backend's
copy) is extracted from the same project (the game data in it is PONOS's).

The bundled unit names and icons come from the
[Battle Cats Wiki](https://battlecats.miraheze.org/) and remain subject to their
own terms; The Unlicense covers this project's code, not those third-party assets.
