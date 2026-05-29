"""Loader for the static master Cat Guide list (cat_guide_master.json).

Region-swappable: the default file is BCEN; other regions can be dropped in as
`cat_guide_master_<region>.json` next to it. The in-game Cat Guide order differs
per region, so owned-state is keyed by (region, global_index) in the DB.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache

from .names import NameMatcher

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
DEFAULT_FILE = os.path.join(DATA_DIR, "cat_guide_master.json")


class MasterData:
    def __init__(self, path: str):
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
        self.path = path
        self.meta: dict = payload.get("_meta", {})
        self.units: list[dict] = payload["units"]
        self.region: str = self.meta.get("region", "BCEN (English)")
        self.by_index: dict[int, dict] = {u["global_index"]: u for u in self.units}
        self.matcher = NameMatcher(self.units)

    def with_owned(self, owned: set[int]) -> list[dict]:
        """Return units annotated with an `owned` flag."""
        out = []
        for u in self.units:
            d = dict(u)
            d["owned"] = u["global_index"] in owned
            out.append(d)
        return out

    def index_for_name(self, godfat_name: str):
        unit = self.matcher.match(godfat_name)
        return unit["global_index"] if unit else None


def discover_regions() -> dict[str, str]:
    """Map region label -> json path for every master file present."""
    regions: dict[str, str] = {}
    if not os.path.isdir(DATA_DIR):
        return regions
    for fn in os.listdir(DATA_DIR):
        if fn.startswith("cat_guide_master") and fn.endswith(".json"):
            path = os.path.join(DATA_DIR, fn)
            try:
                meta = json.load(open(path, encoding="utf-8")).get("_meta", {})
                regions[meta.get("region", fn)] = path
            except (json.JSONDecodeError, OSError):
                continue
    return regions


@lru_cache(maxsize=8)
def load_master(path: str = DEFAULT_FILE) -> MasterData:
    return MasterData(path)


def master_for_region(region: str) -> MasterData:
    regions = discover_regions()
    path = regions.get(region, DEFAULT_FILE)
    return load_master(path)
