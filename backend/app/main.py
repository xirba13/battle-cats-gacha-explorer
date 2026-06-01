"""FastAPI application — stateless API over the pathfinder + godfat ingestion.

Stores nothing: the client holds all state (owned units, seed, resources) and
passes it in with each request. godfat pages are cached in RAM only.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import godfat, pathfinder, services
from .master import load_master

DISCLAIMER = (
    "This tool is experimental and not fully tested. Every path is re-simulated "
    "against the parsed godfat data before being shown, but ALWAYS check a path "
    "on bc.godfat.org before spending real resources."
)

app = FastAPI(title="Battle Cats Gacha Explorer", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# One shared, in-memory-cached godfat client (no disk writes).
_client = godfat.GodfatClient(cache_dir=None)
# Cache-dir override only for tests that want a disk cache or a mock transport.
if os.environ.get("BCPE_CACHE"):
    _client = godfat.GodfatClient(cache_dir=os.environ["BCPE_CACHE"])


def master():
    return load_master()


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
        events = _client.fetch_event_list(seed)
    except Exception as e:  # network/godfat failure
        raise HTTPException(status_code=502, detail=f"godfat fetch failed: {e}")
    return {"seed": seed, "events": [e.to_dict() for e in events]}


@app.post("/api/search")
def search(body: SearchIn):
    resources = body.resources.model_dump()
    try:
        ingestion = godfat.ingest_upcoming(
            _client, body.seed, count=body.count,
            resources=resources, event_ids=set(body.event_ids),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"godfat fetch failed: {e}")

    result = services.run_search(
        ingestion.banners, master(), set(body.owned), resources,
        wishlist=body.wishlist, mode=body.mode, max_solutions=body.max_solutions,
    )
    result["seed"] = body.seed
    result["skipped"] = ingestion.skipped
    result["disclaimer"] = DISCLAIMER
    return result


@app.post("/api/followed")
def followed(body: FollowedIn):
    resources = body.resources.model_dump() if body.resources else None
    result = services.followed_result(master(), body.solution, set(body.owned), resources)
    result["prompt"] = ("Path recorded. Your new seed has been filled in "
                        "automatically — verify it on bc.godfat.org, then search again.")
    return result
