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
