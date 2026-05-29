"""FastAPI application: REST API over the pathfinder, godfat ingestion,
persistence, and screenshot detection."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import godfat, pathfinder, services
from .db import Database
from .master import discover_regions, master_for_region

VAR_DIR = os.path.join(os.path.dirname(__file__), "..", "var")
os.makedirs(VAR_DIR, exist_ok=True)
DB_PATH = os.environ.get("BCPE_DB", os.path.join(VAR_DIR, "app.sqlite"))
CACHE_DIR = os.environ.get("BCPE_CACHE", os.path.join(VAR_DIR, "godfat_cache"))
UNMATCHED_LOG = os.path.join(VAR_DIR, "unmatched_names.log")

DISCLAIMER = (
    "This tool is experimental and not fully tested. Every path is re-simulated "
    "against the parsed godfat data before being shown, but ALWAYS sanity-check a "
    "path on godfat.org before spending real resources."
)

app = FastAPI(title="Battle Cats Optimal-Pull Path Tracker", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

db = Database(DB_PATH)
_godfat_client: Optional[godfat.GodfatClient] = None


def get_client() -> godfat.GodfatClient:
    global _godfat_client
    if _godfat_client is None:
        _godfat_client = godfat.GodfatClient(cache_dir=CACHE_DIR)
    return _godfat_client


def current_master():
    return master_for_region(db.get_region())


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #

class ResourcesIn(BaseModel):
    rare_tickets: int = 0
    cat_food: int = 0
    platinum_tickets: int = 0
    legend_tickets: int = 0


class SeedIn(BaseModel):
    seed: Optional[str] = None


class RegionIn(BaseModel):
    region: str


class ToggleIn(BaseModel):
    global_index: int
    owned: bool


class BulkOwnedIn(BaseModel):
    indices: list[int]
    owned: bool


class SearchIn(BaseModel):
    seed: str
    event_ids: list[str]
    count: int = godfat.DEFAULT_COUNT
    resources: Optional[ResourcesIn] = None
    wishlist: Optional[list[str]] = None
    mode: str = pathfinder.MODE_RESOURCE_LIMIT
    max_solutions: int = 20


class FollowedIn(BaseModel):
    solution: dict
    seed_before: Optional[str] = None


# --------------------------------------------------------------------------- #
# State & config
# --------------------------------------------------------------------------- #

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/state")
def get_state():
    region = db.get_region()
    return {
        "region": region,
        "regions": sorted(discover_regions().keys()) or [region],
        "seed": db.get_seed(),
        "resources": db.get_resources(),
        "owned_count": len(db.get_owned(region)),
        "disclaimer": DISCLAIMER,
    }


@app.put("/api/resources")
def put_resources(body: ResourcesIn):
    return {"resources": db.set_resources(body.model_dump())}


@app.put("/api/seed")
def put_seed(body: SeedIn):
    db.set_seed(body.seed)
    return {"seed": db.get_seed()}


@app.put("/api/region")
def put_region(body: RegionIn):
    db.set_region(body.region)
    return {"region": db.get_region()}


# --------------------------------------------------------------------------- #
# Master list + owned state (Section 2)
# --------------------------------------------------------------------------- #

@app.get("/api/master")
def get_master():
    master = current_master()
    owned = db.get_owned()
    return {"meta": master.meta, "units": master.with_owned(owned)}


@app.post("/api/owned/toggle")
def toggle_owned(body: ToggleIn):
    db.set_owned(body.global_index, body.owned)
    return {"global_index": body.global_index, "owned": body.owned,
            "owned_count": len(db.get_owned())}


@app.post("/api/owned/bulk")
def bulk_owned(body: BulkOwnedIn):
    db.set_owned_bulk(body.indices, body.owned)
    return {"updated": len(body.indices), "owned_count": len(db.get_owned())}


@app.post("/api/owned/clear")
def clear_owned():
    db.clear_owned()
    return {"owned_count": 0}


# --------------------------------------------------------------------------- #
# godfat events + pathfinding (Section 3)
# --------------------------------------------------------------------------- #

@app.get("/api/events")
def get_events(seed: str, count: int = godfat.DEFAULT_COUNT):
    try:
        events = get_client().fetch_event_list(seed)
    except Exception as e:  # network/godfat failure
        raise HTTPException(status_code=502, detail=f"godfat fetch failed: {e}")
    return {"seed": seed, "events": [e.to_dict() for e in events]}


@app.post("/api/search")
def search(body: SearchIn):
    resources = (body.resources.model_dump() if body.resources else db.get_resources())
    try:
        ingestion = godfat.ingest_upcoming(
            get_client(), body.seed, count=body.count,
            resources=resources, event_ids=set(body.event_ids),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"godfat fetch failed: {e}")

    master = current_master()
    # Persist unmatched names from this ingestion for manual reconciliation.
    master.matcher.write_unmatched(UNMATCHED_LOG)

    result = services.run_search(
        ingestion.banners, master, db.get_owned(), resources,
        wishlist=body.wishlist, mode=body.mode, max_solutions=body.max_solutions,
    )
    result["seed"] = body.seed
    result["skipped"] = ingestion.skipped
    result["disclaimer"] = DISCLAIMER
    return result


@app.post("/api/followed")
def followed(body: FollowedIn):
    master = current_master()
    seed_before = body.seed_before if body.seed_before is not None else db.get_seed()
    result = services.apply_followed_path(db, master, body.solution, seed_before)
    result["prompt"] = ("Path recorded. Re-pull in-game, then re-read and enter your "
                        "NEW seed to search again.")
    return result


@app.get("/api/history")
def history(limit: int = 100):
    return {"history": db.get_history(limit)}


# --------------------------------------------------------------------------- #
# Screenshot import (Section 1) — implemented in M5
# --------------------------------------------------------------------------- #

@app.post("/api/screenshot")
async def screenshot(file: UploadFile = File(...), page: Optional[int] = None):
    from . import vision
    data = await file.read()
    try:
        result = vision.detect_screenshot(data, current_master(), page_hint=page)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"detection failed: {e}")
    return result
