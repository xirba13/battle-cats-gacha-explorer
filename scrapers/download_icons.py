#!/usr/bin/env python3
"""
download_icons.py — fetch the Cat Guide unit icons referenced by a master JSON
into a local folder, so the frontend can serve them locally instead of hitting
the wiki CDN on every render.

By default reads backend/data/cat_guide_master.json and writes the icons to
frontend/public/icons/<icon filename> (e.g. Uni000_f00.png), skipping any that
already exist.

Examples:
  python scrapers/download_icons.py
  python scrapers/download_icons.py --master backend/data/cat_guide_master_jp.json
"""

import argparse
import json
import os
import sys
import time

import httpx

ROOT = os.path.join(os.path.dirname(__file__), "..")
DEFAULT_MASTER = os.path.join(ROOT, "backend", "data", "cat_guide_master.json")
DEFAULT_OUT = os.path.join(ROOT, "frontend", "public", "icons")
UA = "BattleCatsPathExplorer/0.1 (local icon cache; contact xabier.cendon@gmail.com)"


def main():
    ap = argparse.ArgumentParser(description="Download Cat Guide unit icons locally.")
    ap.add_argument("--master", default=DEFAULT_MASTER, help="Path to a cat_guide_master*.json")
    ap.add_argument("--out", default=DEFAULT_OUT, help="Output icons directory")
    ap.add_argument("--force", action="store_true", help="Re-download even if the file exists")
    args = ap.parse_args()

    with open(args.master, encoding="utf-8") as f:
        units = json.load(f)["units"]
    os.makedirs(args.out, exist_ok=True)

    downloaded = skipped = failed = 0
    failures = []
    with httpx.Client(headers={"User-Agent": UA}, timeout=30.0, follow_redirects=True) as client:
        for i, u in enumerate(units):
            icon, url = u.get("icon"), u.get("icon_url")
            if not icon or not url:
                continue
            dest = os.path.join(args.out, icon)
            if os.path.exists(dest) and not args.force:
                skipped += 1
                continue
            try:
                r = client.get(url)
                r.raise_for_status()
                with open(dest, "wb") as out:
                    out.write(r.content)
                downloaded += 1
            except Exception as e:  # noqa: BLE001
                failed += 1
                failures.append((icon, str(e)))
            if (i + 1) % 50 == 0:
                print(f"  ...{i + 1}/{len(units)} (downloaded {downloaded}, skipped {skipped})")
            time.sleep(0.02)  # be gentle on the CDN

    print(f"Done. downloaded={downloaded} skipped={skipped} failed={failed} -> {args.out}")
    if failures:
        print("Failures:")
        for icon, err in failures[:20]:
            print(f"  {icon}: {err}")


if __name__ == "__main__":
    main()
