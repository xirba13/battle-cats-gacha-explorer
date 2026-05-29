#!/usr/bin/env python3
"""
update_cat_guide.py
Regenerate cat_guide_master.json from the Battle Cats Wiki Cat Guide page.

Two input modes:
  1) Live fetch:   --url https://battlecats.miraheze.org/wiki/Cat_Guide
  2) Saved file:   --input Cat_Guide.html   (raw .html OR a "Save page as" .mhtml)

Miraheze sometimes blocks automated requests (bot detection). If the live
fetch fails, just open the page in your browser, Save As (Webpage / .mhtml or
.html), and pass it with --input. The parser handles both formats.

Examples:
  python update_cat_guide.py --url https://battlecats.miraheze.org/wiki/Cat_Guide
  python update_cat_guide.py --input Cat_Guide.mhtml --region en --output cat_guide_master.json
"""

import argparse
import html
import json
import re
import sys
import urllib.request

# Wiki version tab -> article id used on the page
REGION_TAB = {
    "en": "English_Version",
    "jp": "Japanese_Version",
    "kr": "Korean_Version",
    "tw": "Taiwanese_Version",
}
REGION_LABEL = {
    "en": "BCEN (English)",
    "jp": "BCJP (Japanese)",
    "kr": "BCKR (Korean)",
    "tw": "BCTW (Taiwanese)",
}
TAB_ORDER = ["English_Version", "Japanese_Version", "Korean_Version", "Taiwanese_Version"]

# Cat Guide rarity label -> the label godfat uses
RARITY_GODFAT = {"Uber Super Rare": "Uber Rare", "Legendary": "Legend Rare"}

UNIT_RE = re.compile(
    r'<a href="https://battlecats\.miraheze\.org/wiki/[^"]+"\s+title="([^"]+)">'
    r'<img[^>]*src="([^"]*?/(?:\d+px-)?(Uni[^"/]+\.png))"',
    re.DOTALL,
)
PANEL_RE = re.compile(r'id="mw-customcollapsible-(page\d+)"')
RARITY_RE = re.compile(r'class="rarity-button[^"]*"[^>]*>([^<]+)</div>')


def load_source(args) -> str:
    if args.input:
        # latin-1 tolerates the binary segments of an .mhtml file
        with open(args.input, "r", encoding="latin-1") as f:
            return f.read()
    req = urllib.request.Request(
        args.url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        sys.exit(
            f"Live fetch failed ({e}).\n"
            "Miraheze likely blocked the request. Open the page in your browser, "
            "Save As (.mhtml or .html), and re-run with --input FILE."
        )


def slice_region(content: str, region: str) -> str:
    """Return only the chosen version tab's article, so other regions don't bleed in."""
    tab_id = REGION_TAB[region]
    start = content.find(f'id="{tab_id}"')
    if start == -1:
        sys.exit(f"Could not find the '{tab_id}' section. Is this the Cat Guide page?")
    # End at the next version tab that appears after start (whichever comes first)
    later = [content.find(f'id="{t}"', start + 1) for t in TAB_ORDER]
    later = [p for p in later if p != -1]
    end = min(later) if later else len(content)
    return content[start:end]


def parse(section: str):
    panels = list(PANEL_RE.finditer(section))
    if not panels:
        sys.exit("No Cat Guide panels found. The page structure may have changed.")
    units = []
    gidx = 0
    for i, m in enumerate(panels):
        nxt = panels[i + 1].start() if i + 1 < len(panels) else len(section)
        chunk = section[m.end():nxt]
        rar_m = RARITY_RE.search(chunk)
        rarity = html.unescape(rar_m.group(1).strip()) if rar_m else "Unknown"
        for slot, (name, url, icon) in enumerate(UNIT_RE.findall(chunk)):
            units.append({
                "global_index": gidx,
                "page": i + 1,
                "slot": slot,
                "row": slot // 6,
                "col": slot % 6,
                "name": html.unescape(name).strip(),
                "rarity_guide": rarity,
                "rarity_godfat": RARITY_GODFAT.get(rarity, rarity),
                "icon": icon,
                "icon_url": url if url.startswith("http") else None,
            })
            gidx += 1
    return units, len(panels)


def main():
    ap = argparse.ArgumentParser(description="Regenerate cat_guide_master.json from the Battle Cats Wiki.")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--url", help="Live Cat Guide URL (battlecats.miraheze.org/wiki/Cat_Guide)")
    src.add_argument("--input", help="Path to a saved .html or .mhtml of the Cat Guide page")
    ap.add_argument("--region", default="en", choices=REGION_TAB.keys(), help="Version tab to parse (default: en)")
    ap.add_argument("--output", default="cat_guide_master.json", help="Output JSON path")
    args = ap.parse_args()

    content = load_source(args)
    section = slice_region(content, args.region)
    units, pages = parse(section)

    out = {
        "_meta": {
            "source": "battlecats.miraheze.org/wiki/Cat_Guide",
            "region": REGION_LABEL[args.region],
            "layout": "6 cols x 4 rows per page",
            "total": len(units),
            "pages": pages,
            "note": "Order mirrors in-game Cat Guide with NO filter applied. First forms (f00) only.",
        },
        "units": units,
    }
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # Summary so you can sanity-check after each game update
    from collections import Counter
    by_rar = Counter(u["rarity_guide"] for u in units)
    print(f"Wrote {args.output}: {len(units)} units across {pages} pages ({REGION_LABEL[args.region]}).")
    print("By rarity:", dict(by_rar))
    missing = [u["name"] for u in units if not u["icon_url"]]
    if missing:
        print(f"WARNING: {len(missing)} units missing icon_url:", missing[:10])


if __name__ == "__main__":
    main()
