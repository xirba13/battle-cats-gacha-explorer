"""SQLite persistence: owned-unit state, player resources/seed, and a history
of followed paths. The master unit list is static data (cat_guide_master.json),
not stored here — only per-player mutable state lives in the DB.

Owned state is keyed by (region, global_index) so the master list stays
swappable per region (see DECISIONS.md).
"""

from __future__ import annotations

import json
import sqlite3
import time
from typing import Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS owned (
    region       TEXT NOT NULL,
    global_index INTEGER NOT NULL,
    PRIMARY KEY (region, global_index)
);

CREATE TABLE IF NOT EXISTS history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           REAL NOT NULL,
    region       TEXT NOT NULL,
    seed_before  TEXT,
    seed_after   TEXT,
    solution     TEXT NOT NULL,   -- JSON of the followed Solution
    units_added  TEXT NOT NULL,   -- JSON list of {name, global_index|null}
    cost         TEXT NOT NULL,   -- JSON resource dict
    resources_after TEXT          -- JSON resource dict
);
"""

DEFAULT_RESOURCES = {
    "rare_tickets": 0,
    "cat_food": 0,
    "platinum_tickets": 0,
    "legend_tickets": 0,
}


class Database:
    def __init__(self, path: str):
        self.path = path
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    def close(self):
        self._conn.close()

    # -- settings ---------------------------------------------------------- #
    def get_setting(self, key: str, default=None):
        row = self._conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set_setting(self, key: str, value) -> None:
        self._conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )
        self._conn.commit()

    def get_region(self) -> str:
        return self.get_setting("region", "BCEN (English)")

    def set_region(self, region: str) -> None:
        self.set_setting("region", region)

    def get_seed(self) -> Optional[str]:
        return self.get_setting("seed", None)

    def set_seed(self, seed: Optional[str]) -> None:
        self.set_setting("seed", seed)

    def get_resources(self) -> dict:
        return self.get_setting("resources", dict(DEFAULT_RESOURCES))

    def set_resources(self, resources: dict) -> None:
        merged = dict(DEFAULT_RESOURCES)
        merged.update({k: int(v) for k, v in (resources or {}).items() if k in DEFAULT_RESOURCES})
        self.set_setting("resources", merged)
        return merged

    # -- owned ------------------------------------------------------------- #
    def get_owned(self, region: Optional[str] = None) -> set[int]:
        region = region or self.get_region()
        rows = self._conn.execute(
            "SELECT global_index FROM owned WHERE region=?", (region,)
        ).fetchall()
        return {r["global_index"] for r in rows}

    def set_owned(self, global_index: int, owned: bool, region: Optional[str] = None) -> None:
        region = region or self.get_region()
        if owned:
            self._conn.execute(
                "INSERT OR IGNORE INTO owned(region, global_index) VALUES(?, ?)",
                (region, global_index),
            )
        else:
            self._conn.execute(
                "DELETE FROM owned WHERE region=? AND global_index=?",
                (region, global_index),
            )
        self._conn.commit()

    def set_owned_bulk(self, indices, owned: bool, region: Optional[str] = None) -> None:
        region = region or self.get_region()
        data = [(region, int(i)) for i in indices]
        if owned:
            self._conn.executemany(
                "INSERT OR IGNORE INTO owned(region, global_index) VALUES(?, ?)", data
            )
        else:
            self._conn.executemany(
                "DELETE FROM owned WHERE region=? AND global_index=?", data
            )
        self._conn.commit()

    def clear_owned(self, region: Optional[str] = None) -> None:
        region = region or self.get_region()
        self._conn.execute("DELETE FROM owned WHERE region=?", (region,))
        self._conn.commit()

    # -- history ----------------------------------------------------------- #
    def add_history(self, region, seed_before, seed_after, solution, units_added,
                    cost, resources_after) -> int:
        cur = self._conn.execute(
            "INSERT INTO history(ts, region, seed_before, seed_after, solution, "
            "units_added, cost, resources_after) VALUES(?,?,?,?,?,?,?,?)",
            (time.time(), region, seed_before, seed_after,
             json.dumps(solution), json.dumps(units_added),
             json.dumps(cost), json.dumps(resources_after)),
        )
        self._conn.commit()
        return cur.lastrowid

    def get_history(self, limit: int = 100) -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM history ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()
        out = []
        for r in rows:
            out.append({
                "id": r["id"],
                "ts": r["ts"],
                "region": r["region"],
                "seed_before": r["seed_before"],
                "seed_after": r["seed_after"],
                "solution": json.loads(r["solution"]),
                "units_added": json.loads(r["units_added"]),
                "cost": json.loads(r["cost"]),
                "resources_after": json.loads(r["resources_after"]) if r["resources_after"] else None,
            })
        return out
