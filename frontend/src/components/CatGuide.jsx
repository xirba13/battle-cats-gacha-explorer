import React, { useMemo, useState } from "react";
import UnitIcon from "./UnitIcon.jsx";
import { decodeOwned, encodeOwned } from "../owncode.js";

const RARITY_CLASS = {
  Normal: "r-normal",
  Special: "r-special",
  Rare: "r-rare",
  "Super Rare": "r-superrare",
  "Uber Super Rare": "r-uber",
  Legendary: "r-legend",
};

export default function CatGuide({ master, owned, toggleOwned, replaceOwned, setError }) {
  const [filter, setFilter] = useState("all"); // all | owned | missing
  const [rarity, setRarity] = useState("all");
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteVal, setPasteVal] = useState("");
  const [copied, setCopied] = useState(null);

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

  const rarities = useMemo(
    () => (master ? [...new Set(master.units.map((u) => u.rarity_guide))] : []),
    [master]
  );

  const code = useMemo(() => encodeOwned(owned), [owned]);

  if (!master) return <div className="loading">Loading Cat Guide…</div>;

  const q = query.trim().toLowerCase();
  const visible = (u) => {
    if (q && !u.name.toLowerCase().includes(q)) return false;
    if (rarity !== "all" && u.rarity_guide !== rarity) return false;
    if (filter === "owned" && !owned.has(u.global_index)) return false;
    if (filter === "missing" && owned.has(u.global_index)) return false;
    return true;
  };
  const matchCount = q ? master.units.filter(visible).length : null;

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Couldn't copy to clipboard — copy it manually.");
    }
  };

  const loadCode = () => {
    const c = pasteVal.trim();
    if (!c) return;
    const set = decodeOwned(c);
    replaceOwned(set);
    setPasteVal("");
    setPasteOpen(false);
  };

  return (
    <div className="cat-guide">
      <div className="save-panel">
        <div>
          <b>Your collection is saved in the page URL.</b>{" "}
          <span className="muted small">
            Bookmark it or copy your code to restore it later — nothing is stored on any server.
          </span>
        </div>
        <div className="save-actions">
          <button onClick={() => copy(window.location.href, "link")}>
            {copied === "link" ? "✓ Copied!" : "Copy link"}
          </button>
          <button onClick={() => copy(code, "code")} disabled={!code}>
            {copied === "code" ? "✓ Copied!" : "Copy code"}
          </button>
          <button onClick={() => setPasteOpen((v) => !v)}>Load a code…</button>
        </div>
        {pasteOpen && (
          <div className="paste-row">
            <input
              value={pasteVal}
              placeholder="paste your saved code here"
              onChange={(e) => setPasteVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadCode()}
            />
            <button className="primary" onClick={loadCode}>Load</button>
            <span className="muted small">Replaces your current owned units.</span>
          </div>
        )}
      </div>

      <div className="guide-toolbar">
        <div className="guide-search">
          <input
            type="search"
            value={query}
            placeholder="🔍 Search unit name…"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <button className="small" onClick={() => setQuery("")}>clear</button>}
          {matchCount != null && (
            <span className="muted small">{matchCount} match{matchCount === 1 ? "" : "es"}</span>
          )}
        </div>
        <span className="muted">
          {owned.size} / {master.units.length} owned ({master.meta.region})
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
        <span className="muted small">Click a tile to toggle owned. Grey = not owned.</span>
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
                const isOwned = owned.has(u.global_index);
                return (
                  <button
                    key={u.global_index}
                    className={"tile " + (isOwned ? "owned " : "locked ") + (RARITY_CLASS[u.rarity_guide] || "")}
                    title={`#${u.global_index} ${u.name} (${u.rarity_guide})`}
                    onClick={() => toggleOwned(u.global_index)}
                  >
                    <UnitIcon unit={u} />
                    <span className="tile-name">{u.name}</span>
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
