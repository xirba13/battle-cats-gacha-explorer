"""Name normalisation / alias layer between godfat and the master Cat Guide.

godfat roll tables and the master `cat_guide_master.json` don't always spell
unit names identically (apostrophes, `&` vs `and`, region quirks). This module
normalises both sides to a common key and exposes a matcher that logs anything
it can't reconcile, rather than silently dropping it.
"""

from __future__ import annotations

import html
import re
from typing import Optional

# Explicit aliases for cases normalisation alone can't bridge.
# Key and value are both *raw* names; both are normalised before lookup.
MANUAL_ALIASES: dict[str, str] = {
    # "godfat name": "master Cat Guide name"
    # (populated as real mismatches surface via unmatched_names.log)
}


def normalize(name: str) -> str:
    """Collapse a unit name to a comparison key."""
    s = html.unescape(name or "").strip().lower()
    s = s.replace("’", "'").replace("‘", "'").replace("`", "'")
    s = s.replace("&", " and ")
    s = s.replace("'", "")              # Li'l -> lil, D'arc -> darc
    s = re.sub(r"[^a-z0-9]+", " ", s)   # any other punctuation -> space
    s = re.sub(r"\s+", " ", s).strip()
    return s


class NameMatcher:
    """Match godfat unit names against the master unit list."""

    def __init__(self, units: list[dict]):
        self.units = units
        self.by_norm: dict[str, dict] = {}
        for u in units:
            self.by_norm.setdefault(normalize(u["name"]), u)
        self._alias_norm = {normalize(k): normalize(v) for k, v in MANUAL_ALIASES.items()}
        self.unmatched: set[str] = set()

    def match(self, godfat_name: str) -> Optional[dict]:
        """Return the master unit dict for a godfat name, or None (and record it)."""
        key = normalize(godfat_name)
        if key in self._alias_norm:
            key = self._alias_norm[key]
        unit = self.by_norm.get(key)
        if unit is None:
            self.unmatched.add(godfat_name)
        return unit

    def match_name(self, godfat_name: str) -> Optional[str]:
        u = self.match(godfat_name)
        return u["name"] if u else None

    def write_unmatched(self, path: str) -> None:
        if not self.unmatched:
            return
        with open(path, "a", encoding="utf-8") as f:
            for n in sorted(self.unmatched):
                f.write(n + "\n")
