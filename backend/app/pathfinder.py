"""
pathfinder.py — Battle Cats optimal-pull path search.

Refactored from the upstream experimental script `test2.py`
(github.com/xirba13/Batte-Cats-Gacha-Path-Finder, branch `tests`) into an
importable library.

Core, kept from upstream:
  * HTML parsing of godfat roll tables (`parse_data`, reads `pick('1A')` cells).
  * A*/Dijkstra search over states (position, collected bitmask, last_unit,
    per-banner usage) with a min-heap.
  * Duplicate-rare track switching and guaranteed 11-draws.
  * Pareto-optimal resource domination in the visited set.

Generalised here:
  * Resource model goes from (tickets, catfood) to a 4-vector:
    rare_tickets, cat_food, platinum_tickets, legend_tickets.
  * Pull cost model: a single pull on a normal/rare banner costs
    1 rare ticket OR 150 cat food (the search keeps both Pareto frontiers);
    a guaranteed 11-draw costs 1500 cat food.
  * Platinum Capsules banner: platinum tickets only, single pulls, no 11-draw.
  * Legend Capsules banner: legend tickets only, single pulls, no 11-draw.
  * Returns structured `Solution` objects instead of markdown.

The upstream author marks the tool as experimental and not fully tested.
`verify_solution` re-simulates a returned solution against the parsed banner
data; the test-suite asserts every returned solution verifies.
"""

from __future__ import annotations

import heapq
import html
import itertools
import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

# --------------------------------------------------------------------------- #
# Resource model
# --------------------------------------------------------------------------- #

# Canonical order of the 4 independent resource budgets. Tuples in this module
# follow this order everywhere (search state, Pareto vectors, costs).
RESOURCE_KEYS = ("rare_tickets", "cat_food", "platinum_tickets", "legend_tickets")

# Cost of a single pull paid with cat food, on a normal/rare-ticket banner.
CAT_FOOD_PER_PULL = 150
# Cost of a guaranteed 11-draw, paid entirely with cat food.
CAT_FOOD_PER_11_DRAW = 1500


def empty_resources() -> dict:
    return {k: 0 for k in RESOURCE_KEYS}


def normalize_resources(resources: Optional[dict]) -> dict:
    """Fill in any missing resource keys with 0."""
    out = empty_resources()
    if resources:
        for k, v in resources.items():
            if k not in RESOURCE_KEYS:
                raise ValueError(f"Unknown resource key: {k!r}")
            out[k] = int(v)
    return out


# --------------------------------------------------------------------------- #
# Banner model
# --------------------------------------------------------------------------- #

BANNER_NORMAL = "normal"
BANNER_PLATINUM = "platinum"
BANNER_LEGEND = "legend"


@dataclass
class Banner:
    """A single godfat roll table plus its type/name metadata.

    `rolls` maps a position key ("1A", "1B", ...) to an entry dict produced by
    `parse_data`, with optional keys: unit, alt_unit, alt_next,
    guaranteed_unit, guaranteed_next, alt_guaranteed_unit, alt_guaranteed_next.
    """

    name: str
    rolls: dict
    type: str = BANNER_NORMAL

    @property
    def is_special(self) -> bool:
        return self.type in (BANNER_PLATINUM, BANNER_LEGEND)


# --------------------------------------------------------------------------- #
# Result model
# --------------------------------------------------------------------------- #

# action_type values
ACTION_SINGLE = "single"          # one pull on a normal/rare banner
ACTION_GUARANTEED_11 = "guaranteed_11"  # 11-draw with a guaranteed uber (guaranteed banner)
ACTION_MULTI_11 = "multi_11"      # plain 11-roll (11 normal pulls) on a non-guaranteed banner
ACTION_PLATINUM = "platinum"      # one pull on the Platinum Capsules banner
ACTION_LEGEND = "legend"          # one pull on the Legend Capsules banner

# payment values
PAY_RARE_TICKET = "rare_ticket"
PAY_CAT_FOOD = "cat_food"
PAY_PLATINUM_TICKET = "platinum_ticket"
PAY_LEGEND_TICKET = "legend_ticket"


@dataclass
class Action:
    banner_index: int
    action_type: str
    payment: str
    position_from: str
    position_to: str
    units_pulled: list[str]
    targets_hit: list[str]
    cost: dict = field(default_factory=empty_resources)

    def to_dict(self) -> dict:
        return {
            "banner_index": self.banner_index,
            "action_type": self.action_type,
            "payment": self.payment,
            "position_from": self.position_from,
            "position_to": self.position_to,
            "units_pulled": list(self.units_pulled),
            "targets_hit": list(self.targets_hit),
            "cost": dict(self.cost),
        }


@dataclass
class Solution:
    actions: list[Action]
    cost: dict
    final_position: str
    collected_count: int
    collected_units: list[str]

    def to_dict(self) -> dict:
        return {
            "actions": [a.to_dict() for a in self.actions],
            "cost": dict(self.cost),
            "final_position": self.final_position,
            "collected_count": self.collected_count,
            "collected_units": list(self.collected_units),
        }


# --------------------------------------------------------------------------- #
# godfat roll-table parsing  (ported from test2.parse_data)
# --------------------------------------------------------------------------- #

_CELL_RE = re.compile(
    r'<td[^>]*onclick="pick\(\'([0-9]+)([AB])(R?)(G?)X?\'\)"[^>]*>(.*?)</td>',
    re.DOTALL,
)
_NAME_RE = re.compile(r">([^<]+)</a>")
_NEXT_POS_RE = re.compile(r"(?:<-|->)\s*(\d+[AB])")


def parse_tables(html_content: str) -> list[dict]:
    """Parse godfat roll-table HTML into a list of banner roll dicts.

    Each `<table>` becomes one dict mapping position -> entry. This is the
    upstream `parse_data` logic, taking a string instead of a filename.
    """
    tables = html_content.split("<table")
    banners: list[dict] = []

    for table_content in tables:
        if not table_content.strip():
            continue

        banner_data: dict = {}
        for num, track, is_alt, is_guaranteed, cell_html in _CELL_RE.findall(table_content):
            pos_key = f"{num}{track}"
            cell_text = html.unescape(cell_html)

            name_match = _NAME_RE.search(cell_text)
            unit_name = name_match.group(1).strip() if name_match else None
            if not unit_name:
                continue

            next_pos_match = _NEXT_POS_RE.search(cell_text)
            next_pos = next_pos_match.group(1) if next_pos_match else None

            entry = banner_data.setdefault(pos_key, {})
            if is_guaranteed == "G":
                if is_alt == "R":
                    entry["alt_guaranteed_unit"] = unit_name
                    entry["alt_guaranteed_next"] = next_pos
                else:
                    entry["guaranteed_unit"] = unit_name
                    entry["guaranteed_next"] = next_pos
            else:
                if is_alt == "R":
                    entry["alt_unit"] = unit_name
                    entry["alt_next"] = next_pos
                else:
                    entry["unit"] = unit_name

        if banner_data:
            banners.append(banner_data)

    return banners


def parse_data(filename: str) -> list[dict]:
    """Backwards-compatible: parse a file of godfat roll tables."""
    with open(filename, "r", encoding="utf-8") as f:
        return parse_tables(f.read())


def get_next_pos_normal(current_pos, normal_unit_hint, banner_data, last_unit_name):
    """Resolve a single pull at `current_pos` on a roll table.

    Returns (unit_got, next_pos, note). Handles duplicate-rare track switching:
    if the unit we would normally get equals the last unit pulled and an
    alternate track exists, we take the alternate unit/next position.
    """
    entry = banner_data.get(current_pos)
    if not entry:
        return None, None, None

    num = int(current_pos[:-1])
    track = current_pos[-1]
    normal_unit = entry.get("unit")

    if last_unit_name and normal_unit == last_unit_name and "alt_unit" in entry:
        actual_unit = entry["alt_unit"]
        next_p = entry.get("alt_next")
        return actual_unit, next_p, "Duplicate"

    return normal_unit, f"{num + 1}{track}", "Normal"


# --------------------------------------------------------------------------- #
# Pareto domination over the 4-resource vector
# --------------------------------------------------------------------------- #

def _dominated(candidate: tuple, frontier: list[tuple]) -> bool:
    """True if some vector in `frontier` is <= `candidate` in every component
    (i.e. an existing state reached here at least as cheaply on all budgets)."""
    for existing in frontier:
        if all(e <= c for e, c in zip(existing, candidate)):
            return True
    return False


def _insert_frontier(candidate: tuple, frontier: list[tuple]) -> list[tuple]:
    """Drop any frontier vector dominated by `candidate`, then add it."""
    kept = [v for v in frontier if not all(c <= e for c, e in zip(candidate, v))]
    kept.append(candidate)
    return kept


# --------------------------------------------------------------------------- #
# Search
# --------------------------------------------------------------------------- #

MODE_STRICT = "STRICT"
MODE_BEST_EFFORT = "BEST_EFFORT"
MODE_RESOURCE_LIMIT = "RESOURCE_LIMIT"

# Rough scalarisation used only for heap ordering (not correctness — Pareto
# domination guards correctness). Tickets are weighted by their cat-food value.
_PRIORITY_WEIGHTS = (CAT_FOOD_PER_PULL, 1, CAT_FOOD_PER_11_DRAW, CAT_FOOD_PER_11_DRAW)


def _priority(collected_count: int, res: tuple) -> tuple:
    scalar = sum(w * v for w, v in zip(_PRIORITY_WEIGHTS, res))
    return (-collected_count, scalar) + res


def find_paths(
    banners: Iterable,
    targets: Iterable[str],
    resources: Optional[dict] = None,
    banner_limits: Optional[dict] = None,
    mode: str = MODE_RESOURCE_LIMIT,
    max_steps: int = 2_000_000,
    max_solutions: int = 50,
    start_pos: str = "1A",
) -> list[Solution]:
    """Search for resource-efficient pull paths that collect `targets`.

    Args:
        banners: list of `Banner` objects, or list of raw roll dicts (treated
            as normal banners with auto names).
        targets: unit names to collect (deduplicated, order-independent).
        resources: dict of available budgets (RESOURCE_KEYS); missing keys = 0.
            In RESOURCE_LIMIT mode these are hard caps. In STRICT/BEST_EFFORT
            modes the rare/cat-food budgets are treated as infinite, but
            platinum/legend pulls are still capped by `banner_limits`.
        banner_limits: dict {banner_index: max_actions}. For platinum/legend
            banners this is the ticket count; set 0 (or omit and pass 0 tickets)
            to exclude the banner.
        mode: STRICT | BEST_EFFORT | RESOURCE_LIMIT.
        max_steps: search-iteration cap.
        max_solutions: cap on number of returned solutions at the best tier.

    Returns:
        list[Solution]: ordered (most efficient first).
    """
    banners = _coerce_banners(banners)
    resources = normalize_resources(resources)
    banner_limits = dict(banner_limits or {})

    # Auto-cap special banners by their ticket budget and exclude empties.
    for idx, b in enumerate(banners):
        if b.type == BANNER_PLATINUM:
            banner_limits.setdefault(idx, resources["platinum_tickets"])
        elif b.type == BANNER_LEGEND:
            banner_limits.setdefault(idx, resources["legend_tickets"])

    target_list = sorted(set(targets))
    target_to_id = {name: i for i, name in enumerate(target_list)}
    all_targets_mask = (1 << len(target_list)) - 1

    res_limit_mode = mode == MODE_RESOURCE_LIMIT
    caps = resources  # only enforced in RESOURCE_LIMIT mode
    # Single pulls spend rare tickets first; cat food only once tickets run out.
    rare_ticket_budget = resources["rare_tickets"]

    # visited[state_key] = Pareto frontier of resource vectors reaching it.
    visited: dict = {}
    limited_indices = set(banner_limits.keys())

    def visited_key(pos, collected, last_unit, usage):
        relevant = tuple(usage[i] if i in limited_indices else -1 for i in range(len(usage)))
        return (pos, collected, last_unit, relevant)

    counter = itertools.count()
    pq: list = []
    start_res = (0, 0, 0, 0)
    initial_usage = (0,) * len(banners)
    heapq.heappush(
        pq,
        (_priority(0, start_res), next(counter),
         start_pos, 0, None, initial_usage, start_res, None),
    )
    visited[visited_key(start_pos, 0, None, initial_usage)] = [start_res]

    solutions: list = []
    max_found = 0
    iterations = 0

    def reconstruct(path_node) -> list[Action]:
        actions: list[Action] = []
        curr = path_node
        while curr:
            action, parent = curr
            actions.append(action)
            curr = parent
        actions.reverse()
        return actions

    def record(collected, path_node, pos):
        nonlocal solutions, max_found
        count = bin(collected).count("1")
        if count == 0:
            return
        if count > max_found:
            max_found = count
            solutions = [(reconstruct(path_node), pos, collected)]
        elif count == max_found and len(solutions) < max_solutions:
            solutions.append((reconstruct(path_node), pos, collected))

    def within_caps(res):
        if not res_limit_mode:
            return True
        return all(res[i] <= caps[RESOURCE_KEYS[i]] for i in range(4))

    while pq:
        iterations += 1
        if iterations > max_steps:
            break

        (_, _, pos, collected, last_unit, usage, res, path) = heapq.heappop(pq)

        if mode == MODE_STRICT:
            if collected == all_targets_mask:
                solutions.append((reconstruct(path), pos, collected))
                if len(solutions) >= max_solutions:
                    break
                continue
        else:
            record(collected, path, pos)
            if collected == all_targets_mask:
                continue

        for b_idx, banner in enumerate(banners):
            limit = banner_limits.get(b_idx)
            if limit is not None and usage[b_idx] >= limit:
                continue
            entry = banner.rolls.get(pos)
            if not entry:
                continue

            if banner.type == BANNER_NORMAL:
                _expand_normal(
                    pq, counter, visited, visited_key, within_caps, rare_ticket_budget,
                    b_idx, banner, entry, pos, collected, last_unit, usage, res,
                    path, target_to_id,
                )
            else:
                _expand_special(
                    pq, counter, visited, visited_key, within_caps,
                    b_idx, banner, entry, pos, collected, last_unit, usage, res,
                    path, target_to_id,
                )

    return _build_solutions(banners, solutions, target_list)


def _coerce_banners(banners) -> list[Banner]:
    out = []
    for i, b in enumerate(banners):
        if isinstance(b, Banner):
            out.append(b)
        elif isinstance(b, dict):
            out.append(Banner(name=f"Banner {i + 1}", rolls=b, type=BANNER_NORMAL))
        else:
            raise TypeError(f"Banner {i} is not a Banner or dict: {type(b)!r}")
    return out


def _apply_unit(unit, collected, target_to_id):
    """Return (new_collected, is_new_target). Marks a target bit if newly hit."""
    if unit in target_to_id:
        bit = 1 << target_to_id[unit]
        if not (collected & bit):
            return collected | bit, True
    return collected, False


def _try_push(pq, counter, visited, visited_key, next_pos, new_collected,
              new_last, new_usage, new_res, action, path):
    key = visited_key(next_pos, new_collected, new_last, new_usage)
    frontier = visited.get(key, [])
    if _dominated(new_res, frontier):
        return
    visited[key] = _insert_frontier(new_res, frontier)
    node = (action, path)
    heapq.heappush(
        pq,
        (_priority(bin(new_collected).count("1"), new_res), next(counter),
         next_pos, new_collected, new_last, new_usage, new_res, node),
    )


def _bump_usage(usage, b_idx):
    u = list(usage)
    u[b_idx] += 1
    return tuple(u)


def _expand_normal(pq, counter, visited, visited_key, within_caps, rare_ticket_budget,
                   b_idx, banner, entry, pos, collected, last_unit, usage, res, path,
                   target_to_id):
    rt, cf, pt, lt = res
    new_usage = _bump_usage(usage, b_idx)

    # --- single pull: rare tickets first, then cat food --------------------
    unit, next_p, _note = get_next_pos_normal(pos, entry.get("unit"), banner.rolls, last_unit)
    if unit and next_p:
        new_collected, is_target = _apply_unit(unit, collected, target_to_id)
        targets_hit = [unit] if is_target else []
        if rt < rare_ticket_budget:
            # A rare ticket is still available -> the player must use it (no
            # spending cat food on singles while tickets remain).
            res_s = (rt + 1, cf, pt, lt)
            payment = PAY_RARE_TICKET
            cost = {"rare_tickets": 1, "cat_food": 0, "platinum_tickets": 0, "legend_tickets": 0}
        else:
            # Out of rare tickets -> single pulls now cost cat food.
            res_s = (rt, cf + CAT_FOOD_PER_PULL, pt, lt)
            payment = PAY_CAT_FOOD
            cost = {"rare_tickets": 0, "cat_food": CAT_FOOD_PER_PULL,
                    "platinum_tickets": 0, "legend_tickets": 0}
        if within_caps(res_s):
            act = Action(b_idx, ACTION_SINGLE, payment, pos, next_p, [unit], targets_hit, cost)
            _try_push(pq, counter, visited, visited_key, next_p, new_collected,
                      unit, new_usage, res_s, act, path)

    # --- 11-roll (cat food only) -------------------------------------------
    g_unit = entry.get("guaranteed_unit")
    g_next = entry.get("guaranteed_next")
    res_11 = (rt, cf + CAT_FOOD_PER_11_DRAW, pt, lt)
    if g_unit and g_next:
        # Guaranteed banner: the 11-roll guarantees an uber as the 11th cat.
        if within_caps(res_11):
            units, targets_hit, new_collected, ok = _simulate_11(
                pos, last_unit, banner.rolls, g_unit, collected, target_to_id)
            if ok:
                act = Action(b_idx, ACTION_GUARANTEED_11, PAY_CAT_FOOD, pos, g_next,
                             units, targets_hit,
                             {"rare_tickets": 0, "cat_food": CAT_FOOD_PER_11_DRAW,
                              "platinum_tickets": 0, "legend_tickets": 0})
                _try_push(pq, counter, visited, visited_key, g_next, new_collected,
                          g_unit, new_usage, res_11, act, path)
    else:
        # Non-guaranteed banner (guaranteed columns empty): a plain 11-roll is
        # just 11 consecutive normal pulls for the same 1500 cat food.
        if within_caps(res_11):
            units, targets_hit, new_collected, next_11, ok = _simulate_11_normal(
                pos, last_unit, banner.rolls, collected, target_to_id)
            if ok:
                act = Action(b_idx, ACTION_MULTI_11, PAY_CAT_FOOD, pos, next_11,
                             units, targets_hit,
                             {"rare_tickets": 0, "cat_food": CAT_FOOD_PER_11_DRAW,
                              "platinum_tickets": 0, "legend_tickets": 0})
                _try_push(pq, counter, visited, visited_key, next_11, new_collected,
                          units[-1], new_usage, res_11, act, path)


def _simulate_11(pos, last_unit, rolls, guaranteed_unit, collected, target_to_id):
    """Simulate the 10 normal pulls + 1 guaranteed of an 11-draw."""
    units: list[str] = []
    targets_hit: list[str] = []
    temp_pos, temp_last, temp_collected = pos, last_unit, collected
    for _ in range(10):
        u, np, _ = get_next_pos_normal(temp_pos, None, rolls, temp_last)
        if not u or not np:
            return units, targets_hit, collected, False
        temp_collected, is_t = _apply_unit(u, temp_collected, target_to_id)
        if is_t:
            targets_hit.append(u)
        units.append(u)
        temp_pos, temp_last = np, u
    temp_collected, is_t = _apply_unit(guaranteed_unit, temp_collected, target_to_id)
    if is_t:
        targets_hit.append(guaranteed_unit)
    units.append(guaranteed_unit)
    return units, targets_hit, temp_collected, True


def _simulate_11_normal(pos, last_unit, rolls, collected, target_to_id):
    """Simulate a plain 11-roll: 11 consecutive normal pulls on a non-guaranteed
    banner. Returns (units[11], targets_hit, new_collected, final_next_pos, ok)."""
    units: list[str] = []
    targets_hit: list[str] = []
    temp_pos, temp_last, temp_collected = pos, last_unit, collected
    for _ in range(11):
        u, np, _ = get_next_pos_normal(temp_pos, None, rolls, temp_last)
        if not u or not np:
            return units, targets_hit, collected, None, False
        temp_collected, is_t = _apply_unit(u, temp_collected, target_to_id)
        if is_t:
            targets_hit.append(u)
        units.append(u)
        temp_pos, temp_last = np, u
    return units, targets_hit, temp_collected, temp_pos, True


def _expand_special(pq, counter, visited, visited_key, within_caps, b_idx, banner,
                    entry, pos, collected, last_unit, usage, res, path, target_to_id):
    """Platinum/Legend Capsules: single guaranteed pulls, ticket-only, no 11-draw."""
    rt, cf, pt, lt = res
    unit, next_p, _note = get_next_pos_normal(pos, entry.get("unit"), banner.rolls, last_unit)
    if not unit or not next_p:
        return
    new_collected, is_target = _apply_unit(unit, collected, target_to_id)
    targets_hit = [unit] if is_target else []
    new_usage = _bump_usage(usage, b_idx)

    if banner.type == BANNER_PLATINUM:
        new_res = (rt, cf, pt + 1, lt)
        action_type, payment = ACTION_PLATINUM, PAY_PLATINUM_TICKET
        cost = {"rare_tickets": 0, "cat_food": 0, "platinum_tickets": 1, "legend_tickets": 0}
    else:
        new_res = (rt, cf, pt, lt + 1)
        action_type, payment = ACTION_LEGEND, PAY_LEGEND_TICKET
        cost = {"rare_tickets": 0, "cat_food": 0, "platinum_tickets": 0, "legend_tickets": 1}

    if not within_caps(new_res):
        return
    act = Action(b_idx, action_type, payment, pos, next_p, [unit], targets_hit, cost)
    _try_push(pq, counter, visited, visited_key, next_p, new_collected,
              unit, new_usage, new_res, act, path)


def _build_solutions(banners, raw_solutions, target_list) -> list[Solution]:
    out: list[Solution] = []
    seen: set = set()
    for actions, final_pos, collected in raw_solutions:
        # Trim trailing actions that collect no new target: a path's job is done
        # at the last target it picks up; anything after only wastes resources.
        last_hit = max((i for i, a in enumerate(actions) if a.targets_hit), default=-1)
        if last_hit < 0:
            continue
        actions = actions[: last_hit + 1]
        final_position = actions[-1].position_to

        # Distinct trimmed paths only (different routes can pad to the same one).
        sig = tuple((a.banner_index, a.action_type, a.position_from, a.position_to)
                    for a in actions)
        if sig in seen:
            continue
        seen.add(sig)

        cost = empty_resources()
        collected_units: list[str] = []
        for a in actions:
            for k in RESOURCE_KEYS:
                cost[k] += a.cost.get(k, 0)
            collected_units.extend(a.targets_hit)
        out.append(Solution(
            actions=actions,
            cost=cost,
            final_position=final_position,
            collected_count=bin(collected).count("1"),
            collected_units=collected_units,
        ))
    # Most collected first, then cheapest by scalarised cost.
    out.sort(key=lambda s: (-s.collected_count,
                            sum(_PRIORITY_WEIGHTS[i] * s.cost[RESOURCE_KEYS[i]] for i in range(4))))
    return out


# --------------------------------------------------------------------------- #
# Verification — re-simulate a solution against the parsed banners
# --------------------------------------------------------------------------- #

def verify_solution(banners, solution: Solution) -> tuple[bool, list[str]]:
    """Re-simulate `solution` against `banners`; return (ok, errors).

    Ported from the upstream `path_checker.py` logic: walk each action from the
    start position, recompute the expected unit(s) and next position, and check
    they match what the solution claims. Also checks resource caps consistency.
    """
    banners = _coerce_banners(banners)
    errors: list[str] = []
    pos = "1A"
    last_unit = None

    for i, act in enumerate(solution.actions):
        step = i + 1
        if act.banner_index < 0 or act.banner_index >= len(banners):
            errors.append(f"Step {step}: invalid banner index {act.banner_index}")
            return False, errors
        banner = banners[act.banner_index]
        if act.position_from != pos:
            errors.append(f"Step {step}: position_from {act.position_from} != actual {pos}")
            return False, errors
        if pos not in banner.rolls:
            errors.append(f"Step {step}: position {pos} not in banner {act.banner_index}")
            return False, errors

        if act.action_type == ACTION_GUARANTEED_11:
            entry = banner.rolls[pos]
            g_unit = entry.get("guaranteed_unit")
            g_next = entry.get("guaranteed_next")
            if not g_unit or not g_next:
                errors.append(f"Step {step}: no guaranteed roll at {pos}")
                return False, errors
            units, _hits, _c, ok = _simulate_11(pos, last_unit, banner.rolls, g_unit, 0, {})
            if not ok:
                errors.append(f"Step {step}: 11-draw simulation failed at {pos}")
                return False, errors
            if units != act.units_pulled:
                errors.append(f"Step {step}: 11-draw units mismatch at {pos}: "
                              f"{act.units_pulled} != {units}")
                return False, errors
            if g_next != act.position_to:
                errors.append(f"Step {step}: 11-draw next {g_next} != {act.position_to}")
                return False, errors
            pos, last_unit = g_next, g_unit
        elif act.action_type == ACTION_MULTI_11:
            units, _hits, _c, next_11, ok = _simulate_11_normal(
                pos, last_unit, banner.rolls, 0, {})
            if not ok:
                errors.append(f"Step {step}: 11-roll simulation failed at {pos}")
                return False, errors
            if units != act.units_pulled:
                errors.append(f"Step {step}: 11-roll units mismatch at {pos}: "
                              f"{act.units_pulled} != {units}")
                return False, errors
            if next_11 != act.position_to:
                errors.append(f"Step {step}: 11-roll next {next_11} != {act.position_to}")
                return False, errors
            pos, last_unit = next_11, units[-1]
        else:
            # single pull (normal/platinum/legend)
            unit, next_p, _n = get_next_pos_normal(pos, banner.rolls.get(pos, {}).get("unit"),
                                                   banner.rolls, last_unit)
            if not unit or not next_p:
                errors.append(f"Step {step}: could not simulate single pull at {pos}")
                return False, errors
            if [unit] != act.units_pulled:
                errors.append(f"Step {step}: unit mismatch at {pos}: "
                              f"{act.units_pulled} != [{unit}]")
                return False, errors
            if next_p != act.position_to:
                errors.append(f"Step {step}: next {next_p} != {act.position_to}")
                return False, errors
            pos, last_unit = next_p, unit

    if pos != solution.final_position:
        errors.append(f"Final position {pos} != solution.final_position {solution.final_position}")
        return False, errors

    return True, errors
