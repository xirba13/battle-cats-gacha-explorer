"""Service layer: ties godfat ingestion + name matching + pathfinder + DB.

Pure-ish functions so they can be unit-tested without a live network (pass in
already-built banners or a mock GodfatClient).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from . import pathfinder
from .db import Database
from .master import MasterData


@dataclass
class TargetReport:
    targets: list[str]                 # godfat names to search for (not owned)
    owned_in_banners: list[str]        # godfat names already owned (excluded)
    unmatched: list[str]               # godfat names with no master entry


def compute_targets(
    banners: list[pathfinder.Banner],
    master: MasterData,
    owned: set[int],
    wishlist: Optional[list[str]] = None,
) -> TargetReport:
    """Targets = unique unit names across the banners, minus owned units.

    Matching is done godfat-name -> master -> global_index to decide ownership;
    the *godfat* name is kept as the search target (the roll tables use it).
    A wishlist (godfat or master names) optionally narrows the targets.
    """
    seen: set[str] = set()
    targets: list[str] = []
    owned_names: list[str] = []
    unmatched: list[str] = []

    wishlist_norm = None
    if wishlist:
        from .names import normalize
        wishlist_norm = {normalize(w) for w in wishlist}

    for banner in banners:
        for entry in banner.rolls.values():
            for key in ("unit", "alt_unit", "guaranteed_unit", "alt_guaranteed_unit"):
                name = entry.get(key)
                if not name or name in seen:
                    continue
                seen.add(name)
                idx = master.index_for_name(name)
                if idx is None:
                    unmatched.append(name)
                    # Unknown to master => can't confirm ownership => candidate.
                    is_owned = False
                else:
                    is_owned = idx in owned
                if is_owned:
                    owned_names.append(name)
                    continue
                if wishlist_norm is not None:
                    from .names import normalize
                    if normalize(name) not in wishlist_norm:
                        continue
                targets.append(name)
    return TargetReport(targets=targets, owned_in_banners=owned_names, unmatched=unmatched)


def banner_limits_for(banners: list[pathfinder.Banner], resources: dict) -> dict:
    """Cap special banners by the player's ticket budget."""
    limits: dict[int, int] = {}
    for i, b in enumerate(banners):
        if b.type == pathfinder.BANNER_PLATINUM:
            limits[i] = resources.get("platinum_tickets", 0)
        elif b.type == pathfinder.BANNER_LEGEND:
            limits[i] = resources.get("legend_tickets", 0)
    return limits


def run_search(
    banners: list[pathfinder.Banner],
    master: MasterData,
    owned: set[int],
    resources: dict,
    wishlist: Optional[list[str]] = None,
    mode: str = pathfinder.MODE_RESOURCE_LIMIT,
    max_steps: int = 1_500_000,
    max_solutions: int = 20,
) -> dict:
    """Run the pathfinder against banners and return a JSON-serialisable result."""
    resources = pathfinder.normalize_resources(resources)
    report = compute_targets(banners, master, owned, wishlist)
    limits = banner_limits_for(banners, resources)

    solutions = pathfinder.find_paths(
        banners, report.targets, resources=resources, banner_limits=limits,
        mode=mode, max_steps=max_steps, max_solutions=max_solutions,
    )
    # Re-validate every solution before surfacing (experimental-tool safety net).
    validated = []
    for sol in solutions:
        ok, errors = pathfinder.verify_solution(banners, sol)
        d = sol.to_dict()
        d["verified"] = ok
        d["verify_errors"] = errors
        d["units_pulled_all"] = _annotate_units(_all_units(sol), master)
        validated.append(d)

    return {
        "targets": report.targets,
        "owned_in_banners": report.owned_in_banners,
        "unmatched": sorted(set(report.unmatched)),
        "banners": [{"index": i, "name": b.name, "type": b.type, "positions": len(b.rolls)}
                    for i, b in enumerate(banners)],
        "solutions": validated,
    }


def _all_units(solution: pathfinder.Solution) -> list[str]:
    units: list[str] = []
    for a in solution.actions:
        units.extend(a.units_pulled)
    return units


def _annotate_units(godfat_names: list[str], master: MasterData) -> list[dict]:
    out = []
    for n in godfat_names:
        unit = master.matcher.match(n)
        out.append({
            "godfat_name": n,
            "master_name": unit["name"] if unit else None,
            "global_index": unit["global_index"] if unit else None,
            "rarity": unit.get("rarity_godfat") if unit else None,
        })
    return out


def apply_followed_path(
    db: Database,
    master: MasterData,
    solution_dict: dict,
    seed_before: Optional[str],
) -> dict:
    """Mark every unit pulled along the path as owned, decrement resources, and
    record a history entry. The caller then prompts for the new seed.

    Returns the updated state (owned count, resources, history id).
    """
    region = db.get_region()
    owned_before = set(db.get_owned(region))

    # 1. Mark every pulled unit owned (full draw, not just targets).
    pulled_indices: set[int] = set()
    unmatched: set[str] = set()
    for action in solution_dict.get("actions", []):
        for name in action.get("units_pulled", []):
            unit = master.matcher.match(name)
            if unit:
                pulled_indices.add(unit["global_index"])
            else:
                unmatched.add(name)
    db.set_owned_bulk(pulled_indices, owned=True, region=region)

    # Newly-owned units = pulled units that weren't already owned. (Most pulled
    # cats are commons the player already has; only these are real additions.)
    newly_indices = sorted(pulled_indices - owned_before)
    units_added = [{"global_index": i, "name": master.by_index[i]["name"]}
                   for i in newly_indices]

    # 2. Decrement resources by the solution cost (floored at 0).
    resources = db.get_resources()
    cost = solution_dict.get("cost", {})
    new_resources = {k: max(0, resources.get(k, 0) - int(cost.get(k, 0)))
                     for k in resources}
    new_resources = db.set_resources(new_resources)

    # 3. The old seed is now spent; clear it until the player re-enters one.
    db.set_seed(None)

    # 4. History.
    hid = db.add_history(
        region=region, seed_before=seed_before, seed_after=None,
        solution=solution_dict, units_added=units_added,
        cost=cost, resources_after=new_resources,
    )

    return {
        "history_id": hid,
        "units_added_count": len(newly_indices),    # NEW units only
        "units_pulled_count": len(pulled_indices),  # distinct units pulled (incl. already owned)
        "unmatched_units": sorted(unmatched),
        "resources": new_resources,
        "owned_count": len(db.get_owned(region)),
    }
