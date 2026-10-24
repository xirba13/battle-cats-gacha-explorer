import React, { useMemo, useState } from "react";
import CopyButton from "./CopyButton.jsx";
import UnitIcon from "./UnitIcon.jsx";

const RARITY_CLASS = {
  Normal: "r-normal",
  Special: "r-special",
  Rare: "r-rare",
  "Super Rare": "r-superrare",
  "Uber Super Rare": "r-uber",
  Legendary: "r-legend",
};

export default function CatGuide({ master, owned, ownedCode, toggleOwned, onLoadCode, setError, saving }) {
  const [filter, setFilter] = useState("all"); // all | owned | missing
  const [rarity, setRarity] = useState("all");
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteVal, setPasteVal] = useState("");

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

  const code = ownedCode || "";

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

  const toggleSaving = (e) => {
    if (e.target.checked) {
      saving.setEnabled(true);
    } else if (window.confirm(
      "Stop saving in this browser? This forgets the collection, wishlists, plan, seed and resources " +
        "saved here. Your link still has them."
    )) {
      saving.setEnabled(false);
    }
  };

  const loadCode = async () => {
    const c = pasteVal.trim();
    if (!c) return;
    const n = await onLoadCode(c);
    setPasteVal("");
    setPasteOpen(false);
    if (n === 0) setError("That code didn't contain any known units — check it's complete.");
  };

  return (
    <div className="cat-guide">
      <div className="save-panel">
        <div>
          {saving?.view ? (
            <>
              <b>You're looking at someone's shared plan: nothing is saved in this browser.</b>{" "}
              <span className="muted small">Your own collection and wishlists stay as they are.</span>
            </>
          ) : saving?.enabled ? (
            <>
              <b>Your collection, wishlists, plan, seed and resources are saved in this browser and in the page URL.</b>{" "}
              <span className="muted small">
                Opening the site again brings them back. To move them to another device, use the link (or
                your code, for the collection) — nothing is stored on any server.
              </span>
            </>
          ) : (
            <>
              <b>Your collection is saved in the page URL.</b>{" "}
              <span className="muted small">
                Bookmark it or copy your code to restore it later — nothing is stored on any server.
              </span>
            </>
          )}
        </div>
        <div className="save-actions">
          <CopyButton text={() => window.location.href} label="Copy link" />
          <CopyButton text={() => code} label="Copy code" disabled={!code} />
          <button onClick={() => setPasteOpen((v) => !v)}>Load a code…</button>
          {saving?.view ? null : saving?.available ? (
            <label className="save-toggle small" title="Untick on a shared computer">
              <input type="checkbox" checked={saving.enabled} onChange={toggleSaving} />
              Save in this browser
            </label>
          ) : (
            <span className="muted small save-toggle">
              This browser doesn't let sites save data here (a private window?), so keep your link or code.
            </span>
          )}
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
