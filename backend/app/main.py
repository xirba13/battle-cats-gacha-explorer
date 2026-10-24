"""FastAPI application — stateless API over the pathfinder + local roll tables.

Stores nothing: the client holds all state (owned units, seed, resources) and
passes it in with each request. Roll tables are computed here from godfat's
open data (`godfat_data.py` + `rolls.py`), so bc.godfat.org being slow or down
doesn't matter. That data ships with the app and is refreshed from GitLab in
the background. `BCPE_SOURCE=godfat` switches back to scraping godfat's pages.
"""

from __future__ import annotations

import os
import threading
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import godfat, godfat_data, pathfinder, services
from .master import load_master

DISCLAIMER = (
    "This tool is experimental and not fully tested. Every path is re-simulated "
    "against the roll tables before being shown, but ALWAYS check a path "
    "on bc.godfat.org before spending real resources."
)

# "local" (default): build roll tables from godfat's data. "godfat": scrape them.
SOURCE = os.environ.get("BCPE_SOURCE", "local")
# How often the running server refreshes godfat's data from GitLab (0 = never).
REFRESH_HOURS = float(os.environ.get("BCPE_DATA_REFRESH_HOURS", "12"))
# Deepest table a request can ask for (the UI allows 1000); bounds the work.
MAX_COUNT = 1000

_store = godfat_data.Store.from_file()

# Only used when SOURCE == "godfat": one shared, in-memory-cached client.
_client = godfat.GodfatClient(cache_dir=None)
# Cache-dir override only for tests that want a disk cache or a mock transport.
if os.environ.get("BCPE_CACHE"):
    _client = godfat.GodfatClient(cache_dir=os.environ["BCPE_CACHE"])


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop = threading.Event()
    if SOURCE == "local" and REFRESH_HOURS > 0:
        threading.Thread(target=_store.refresh_loop, args=(REFRESH_HOURS, stop),
                         name="godfat-data-refresh", daemon=True).start()
    yield
    stop.set()


app = FastAPI(title="Battle Cats Gacha Explorer", version="1.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def master():
    return load_master()


def upcoming_events(seed: str):
    if SOURCE == "godfat":
        return _client.fetch_event_list(seed)
    return _store.current().upcoming()


def ingest(seed: str, count: int, resources: dict, event_ids: set[str]):
    if SOURCE == "godfat":
        return godfat.ingest_upcoming(_client, seed, count=count, resources=resources, event_ids=event_ids)
    return godfat_data.ingest(_store.current(), seed, count, resources=resources, event_ids=event_ids)


def data_info() -> dict:
    if SOURCE == "godfat":
        return {"source": "godfat"}
    return {"source": "local", "built_on": _store.current().meta.get("built_on")}


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #

class ResourcesIn(BaseModel):
    rare_tickets: int = 0
    cat_food: int = 0
    platinum_tickets: int = 0
    legend_tickets: int = 0


class SearchIn(BaseModel):
    seed: str
    event_ids: list[str]
    count: int = godfat.DEFAULT_COUNT
    resources: ResourcesIn = ResourcesIn()
    owned: list[int] = []
    wishlist: Optional[list[str]] = None
    mode: str = pathfinder.MODE_RESOURCE_LIMIT
    max_solutions: int = 20


class FollowedIn(BaseModel):
    solution: dict
    owned: list[int] = []
    resources: Optional[ResourcesIn] = None


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/master")
def get_master():
    m = master()
    return {"meta": m.meta, "units": m.units, "disclaimer": DISCLAIMER}


@app.get("/api/events")
def get_events(seed: str, count: int = godfat.DEFAULT_COUNT):
    try:
        events = upcoming_events(seed)
    except Exception as e:  # only the godfat source can fail here
        raise HTTPException(status_code=502, detail=f"godfat fetch failed: {e}")
    return {"seed": seed, "events": [e.to_dict() for e in events], "data": data_info()}


@app.post("/api/search")
def search(body: SearchIn):
    resources = body.resources.model_dump()
    count = max(1, min(body.count, MAX_COUNT))
    try:
        ingestion = ingest(body.seed, count, resources, set(body.event_ids))
    except ValueError as e:  # e.g. a seed that isn't a number
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"banner data failed: {e}")

    result = services.run_search(
        ingestion.banners, master(), set(body.owned), resources,
        wishlist=body.wishlist, mode=body.mode, max_solutions=body.max_solutions,
    )
    result["seed"] = body.seed
    result["skipped"] = ingestion.skipped
    result["data"] = data_info()
    result["disclaimer"] = DISCLAIMER
    return result


@app.post("/api/followed")
def followed(body: FollowedIn):
    resources = body.resources.model_dump() if body.resources else None
    result = services.followed_result(master(), body.solution, set(body.owned), resources)
    result["prompt"] = ("Path recorded. Your new seed has been filled in "
                        "automatically — verify it on bc.godfat.org, then search again.")
    return result
