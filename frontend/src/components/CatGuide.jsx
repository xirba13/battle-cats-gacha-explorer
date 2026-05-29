import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import UnitIcon from "./UnitIcon.jsx";

const RARITY_CLASS = {
  Normal: "r-normal",
  Special: "r-special",
  Rare: "r-rare",
  "Super Rare": "r-superrare",
  "Uber Super Rare": "r-uber",
  Legendary: "r-legend",
};

export default function CatGuide({ master, applyOwned, reloadState, setError, pending }) {
  const [filter, setFilter] = useState("all"); // all | owned | missing
  const [rarity, setRarity] = useState("all");

  const pages = useMemo(() => {
    if (!master) return [];
    const byPage = new Map();
    for (const u of master.units) {
      if (!byPage.has(u.page)) byPage.set(u.page, []);
      byPage.get(u.page).push(u);
    }
    for (const list of byPage.values()) list.sort((a, b) => a.slot - b.slot);
    return [...byPage.entries()].sort((a, b) => a[0] - b[0]);
  }, [master]);

  const rarities = useMemo(() => {
    if (!master) return [];
    return [...new Set(master.units.map((u) => u.rarity_guide))];
  }, [master]);

  if (!master) return <div className="loading">Loading Cat Guide…</div>;

  const visible = (u) => {
    if (rarity !== "all" && u.rarity_guide !== rarity) return false;
    if (filter === "owned" && !u.owned) return false;
    if (filter === "missing" && u.owned) return false;
    return true;
  };

  const toggle = async (u) => {
    const next = !u.owned;
    applyOwned([u.global_index], next); // optimistic
    try {
      await api.toggleOwned(u.global_index, next);
      reloadState();
    } catch (e) {
      applyOwned([u.global_index], u.owned); // revert
      setError(e.message);
    }
  };

  const ownedCount = master.units.filter((u) => u.owned).length;

  return (
    <div className="cat-guide">
      <div className="guide-toolbar">
        <span className="muted">
          {ownedCount} / {master.units.length} owned ({master.meta.region})
        </span>
        <label>
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="owned">Owned only</option>
            <option value="missing">Missing only</option>
          </select>
        </label>
        <label>
          Rarity
          <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
            <option value="all">All</option>
            {rarities.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <span className="muted small">
          Click a tile to toggle owned. Grey = not owned.
        </span>
      </div>

      {pages.map(([page, units]) => {
        const shown = units.filter(visible);
        if (shown.length === 0) return null;
        const rar = units[0].rarity_guide;
        return (
          <section key={page} className="guide-page">
            <h3 className={`page-head ${RARITY_CLASS[rar] || ""}`}>
              Page {page} <span className="muted small">· {rar}</span>
            </h3>
            <div className="grid">
              {shown.map((u) => {
                const pend = pending && pending[u.global_index];
                return (
                  <button
                    key={u.global_index}
                    className={
                      "tile " +
                      (u.owned ? "owned " : "locked ") +
                      (RARITY_CLASS[u.rarity_guide] || "") +
                      (pend ? " pending-" + pend : "")
                    }
                    title={`#${u.global_index} ${u.name} (${u.rarity_guide})`}
                    onClick={() => toggle(u)}
                  >
                    <UnitIcon unit={u} />
                    <span className="tile-name">{u.name}</span>
                    {pend && <span className="pend-flag">{pend === "unlocked" ? "✓?" : "?"}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
