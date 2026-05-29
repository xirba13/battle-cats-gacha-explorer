# Battle Cats — Optimal-Pull Path Tracker

A web app that helps a Battle Cats player find the **most resource-efficient pull
path** to the units they don't yet own, using godfat seed-tracking data.

> ⚠️ **Experimental.** The pathfinding core is ported from an upstream tool the
> original author marks as *not fully tested*. Every path the app shows is
> re-simulated against the parsed godfat data before display, but **always
> sanity-check a path on [godfat.org](https://bc.godfat.org/) before spending
> real resources.**

It has three sections:

1. **Screenshot Import** — upload screenshots of your in-game Cat Guide; the app
   detects which slots are unlocked vs locked and proposes owned units.
2. **Cat Guide** — a wiki-style grid mirroring the in-game Cat Guide order where
   you toggle units owned/not-owned (and confirm screenshot results).
3. **Path Finder** — enter your seed + resources; the app scrapes godfat's
   *Upcoming* banners, computes optimal paths to the units you don't own yet,
   and offers an **"I followed this path"** button that records every newly
   pulled unit as owned, discards the now-invalid paths, and prompts you to
   re-enter your new seed.

## Prerequisites — read this first

- **You must already be seed-tracking.** Like godfat, this app does **not**
  derive your seed; you provide it. Find it with the in-game seed-finding method
  / a tracker, and re-read it after every pull session.
- **Screenshots must use NO filter.** Screenshot the Cat Guide in its **default
  view with no filter applied**. With a filter on, the slot order won't match the
  master list and detection will be wrong.

## Quick start (Docker — recommended)

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000  (docs at `/docs`)

State (SQLite DB, godfat cache, logs) is persisted in `backend/var/`.

## Quick start (local, without Docker)

Requires **Python 3.11** and **Node 20 + pnpm**.

```bash
# backend
python -m venv backend/.venv
backend/.venv/Scripts/pip install -r backend/requirements.txt      # Windows
# backend/.venv/bin/pip install -r backend/requirements.txt        # macOS/Linux
backend/.venv/Scripts/uvicorn app.main:app --reload --port 8000    # (run from backend/)

# frontend (in another terminal)
cd frontend
pnpm install
pnpm dev
```

The Vite dev server proxies `/api` to the backend on port 8000.

`make dev` / `make install` / `make test` wrap these (see the `Makefile`).

## How a typical session goes

1. **Cat Guide** tab — mark what you already own (or use Screenshot Import to
   bulk-fill, then fix any mistakes with one click).
2. Top bar — enter your **seed** and your **resources** (rare tickets, cat food,
   platinum tickets, legend tickets).
3. **Path Finder** tab — *Fetch Upcoming banners*, tick the banners to search
   (special Platinum/Legend banners are pre-selected when you have the tickets),
   then *Find optimal paths*. godfat pages are slow, so results are cached per
   seed.
4. Pick a path, pull it in-game, then click **"I followed this path."** Every
   unit on that path is marked owned and your resources are decremented. Re-read
   your new seed in-game and enter it to search again.

## Tests

```bash
cd backend && .venv/Scripts/python.exe -m pytest      # 38 tests
```

Covers the pathfinder (including 4-resource Pareto + platinum/legend mechanics
and re-simulation of every returned solution), godfat ingestion (offline via a
mock transport), persistence + the followed-path workflow, the FastAPI surface,
and screenshot detection against two real screenshots.

## Re-scrapers

- **godfat banners:** `python scrapers/scrape_godfat.py --seed SEED --list`
  (or `--out banners.json` to dump parsed tables; reuses the app's polite,
  cached, rate-limited client).
- **Master Cat Guide list** (region-swappable): `python scrapers/update_cat_guide.py
  --input Cat_Guide.htm --region en --output backend/data/cat_guide_master.json`
  (or `--url https://battlecats.miraheze.org/wiki/Cat_Guide`). Drop a
  `cat_guide_master_<region>.json` into `backend/data/` and the app will offer
  that region in the top-bar selector.

## Project layout

```
backend/
  app/
    pathfinder.py   # M1: search core (4-resource Pareto, platinum/legend), verify_solution
    godfat.py       # M2: Upcoming-banner scraping (cache + rate limit + backoff)
    names.py        # M2: godfat<->master name normalisation / alias layer
    db.py           # M3: SQLite (owned state, settings, history)
    master.py       # M3: region-swappable master loader
    services.py     # M3/M4: targets, search wiring, followed-path workflow
    vision.py       # M5: screenshot grid detection + locked/unlocked classify
    main.py         # FastAPI app
  data/cat_guide_master.json
  tests/            # 38 tests + fixtures (sample banners + 2 screenshots)
frontend/           # Vite + React (3-tab UI)
scrapers/           # godfat + Cat Guide re-scrapers
DECISIONS.md        # assumptions, godfat URL-scheme findings, banner mechanics
```

See [DECISIONS.md](DECISIONS.md) for the reverse-engineered godfat URL scheme,
banner-mechanic confirmations, and other non-obvious choices.
