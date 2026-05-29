#!/usr/bin/env python3
"""
scrape_godfat.py — standalone re-scraper for godfat banner roll tables.

Reuses the same polite GodfatClient as the app (on-disk cache, rate limiting,
backoff, descriptive User-Agent). Use it to refresh the cache for a seed, list
the Upcoming banners, or dump a single banner's parsed roll table to JSON.

Examples:
  # List the Upcoming banners for a seed
  python scrapers/scrape_godfat.py --seed 4624623 --list

  # Fetch + parse every Upcoming banner and write a summary JSON
  python scrapers/scrape_godfat.py --seed 4624623 --count 100 --out banners.json

  # Dump a single banner (by godfat event id) to JSON
  python scrapers/scrape_godfat.py --seed 4624623 --event 2026-05-29_947 --out one.json
"""

import argparse
import json
import os
import sys

# Make the backend package importable when run from the repo root.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app import godfat  # noqa: E402

DEFAULT_CACHE = os.path.join(os.path.dirname(__file__), "..", "backend", "var", "godfat_cache")


def main():
    # godfat descriptions contain unicode (★, →); make console output safe on
    # Windows code pages.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    ap = argparse.ArgumentParser(description="Re-scrape godfat banner roll tables.")
    ap.add_argument("--seed", required=True, help="The player's seed.")
    ap.add_argument("--count", type=int, default=godfat.DEFAULT_COUNT,
                    help="Seed-track depth (rows) per banner.")
    ap.add_argument("--list", action="store_true", help="Only list Upcoming banners.")
    ap.add_argument("--event", help="Dump a single banner by godfat event id.")
    ap.add_argument("--out", help="Write JSON output to this path.")
    ap.add_argument("--cache", default=DEFAULT_CACHE, help="Cache directory.")
    ap.add_argument("--min-interval", type=float, default=1.5,
                    help="Minimum seconds between requests (politeness).")
    args = ap.parse_args()

    with godfat.GodfatClient(cache_dir=args.cache, min_interval=args.min_interval) as client:
        events = client.fetch_event_list(args.seed)
        print(f"Found {len(events)} Upcoming banners for seed {args.seed}.")

        if args.list:
            for ev in events:
                print(f"  [{ev.banner_type:8s}] {ev.event_id}  {ev.date_start} -> {ev.date_end}  "
                      f"{ev.description[:70]}")
            return

        if args.event:
            ev = next((e for e in events if e.event_id == args.event), None)
            if ev is None:
                sys.exit(f"event {args.event} not found in Upcoming list for this seed")
            banner = client.fetch_banner(args.seed, ev, args.count)
            payload = {
                "seed": str(args.seed), "event_id": ev.event_id, "type": ev.banner_type,
                "name": ev.description, "rolls": banner.rolls if banner else {},
            }
        else:
            ingestion = godfat.ingest_upcoming(client, args.seed, count=args.count)
            payload = {
                "seed": str(args.seed),
                "banners": ingestion.banner_summaries(),
                "events": [e.to_dict() for e in ingestion.events],
                "skipped": ingestion.skipped,
            }
            for b in ingestion.banner_summaries():
                print(f"  banner {b['index']:2d} [{b['type']:8s}] {b['positions']:3d} rows  {b['name'][:60]}")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
