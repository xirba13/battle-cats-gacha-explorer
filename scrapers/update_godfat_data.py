#!/usr/bin/env python3
"""
update_godfat_data.py
Regenerate frontend/public/data/godfat_bcen.json — the banners, gacha pools
and cats the site builds roll tables from — from godfat's open data
(build/bc-en.yaml in https://gitlab.com/godfat/battle-cats-rolls, Apache
License 2.0).

A GitHub Actions job (.github/workflows/update-data.yml) runs this every day
and commits the file when it changed; run it yourself to update it sooner.
(--output backend/data/godfat_bcen.json updates the old server's copy.)

Examples:
  python scrapers/update_godfat_data.py                     # download from GitLab
  python scrapers/update_godfat_data.py --input bc-en.yaml  # a saved copy
"""

import argparse
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app import godfat_data  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", help="read a saved bc-en.yaml instead of downloading it")
    ap.add_argument("--output", default=os.path.join(ROOT, "frontend", "public", "data", "godfat_bcen.json"))
    args = ap.parse_args()

    if args.input:
        with open(args.input, encoding="utf-8") as f:
            text = f.read()
    else:
        req = urllib.request.Request(godfat_data.SOURCE_URL, headers={"User-Agent": godfat_data.USER_AGENT})
        with urllib.request.urlopen(req, timeout=120) as resp:
            text = resp.read().decode("utf-8")

    data = godfat_data.extract(text)
    with open(args.output, "w", encoding="utf-8", newline="\n") as f:
        f.write(godfat_data.dumps(data))
    ds = godfat_data.Dataset(data)
    print(f"Wrote {args.output}: {len(data['events'])} events "
          f"({len(ds.upcoming())} upcoming), {len(data['gacha'])} gachas, {len(data['cats'])} cats.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
