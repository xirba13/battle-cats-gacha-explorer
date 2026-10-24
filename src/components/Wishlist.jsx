import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import * as wl from "../wishlists.js";
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

// Section 2: your wishlists. Units most wanted first (drag them, or use the
// arrows), each list ranked its own way in the Path Finder, and shared as a
// link or code that gives the other person an exact copy.
export default function Wishlist({ master, owned, wishes, setWishes, uids, shareLink, setError, onSearch }) {
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("all");
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  // uid -> names of the Upcoming banners that can give it (null: loading).
  const [upcoming, setUpcoming] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteVal, setPasteVal] = useState("");
  const [msg, setMsg] = useState(null);
  // While a unit is dragged: {from, to} (places in the list).
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    api.events("")
      .then(({ events }) => {
        const m = new Map();
        for (const e of events) {
          for (const uid of e.uids) {
            if (!m.has(uid)) m.set(uid, new Set());
            m.get(uid).add(e.description);
          }
        }
        setUpcoming(m);
      })
      .catch(() => setUpcoming(new Map()));
  }, []);

  const byUid = useMemo(() => new Map((master?.units || []).map((u) => [u.uid, u])), [master]);
  const rarities = useMemo(() => (master ? [...new Set(master.units.map((u) => u.rarity_guide))] : []), [master]);

  if (!master) return <div className="loading">Loading Cat Guide…</div>;

  const list = wishes.lists[wishes.open];
  const update = (fn) => setWishes((w) => wl.changeOpen(w, fn));
  const rankOf = new Map(list.units.map((u, i) => [u.uid, i + 1]));
  const shownUnits = drag ? wl.moved(list, drag.from, drag.to).units : list.units;
  const rankHelp = wl.RANKINGS.find((r) => r.id === list.ranking)?.help;

  const newList = () => {
    const name = window.prompt("Name of the new wishlist:", `Wishlist ${wishes.lists.length + 1}`);
    if (name !== null) setWishes((w) => wl.addList(w, wl.newList(name)));
  };
  const rename = () => {
    const name = window.prompt("New name for this wishlist:", list.name);
    if (name !== null) update((l) => ({ ...l, name: wl.cleanName(name) }));
  };
  const remove = () => {
    if (window.confirm(`Delete the wishlist “${list.name}” (${list.units.length} units)?`)) {
      setWishes((w) => wl.deleteList(w, w.open));
    }
  };
  const addShared = () => {
    const shared = wl.decodeList(pasteVal, uids);
    if (!shared) {
      setError("That isn't a wishlist code or link — check that it's complete.");
      return;
    }
    const r = wl.importList(wishes, shared);
    setWishes(r.wishes);
    setPasteVal("");
    setPasteOpen(false);
    setMsg(r.added ? `Added “${r.name}” (${shared.units.length} units) as a new wishlist.` : `You already have this wishlist (“${r.name}”): it's open now.`);
  };

  // Dragging a unit by its handle: the list shows where it would go, and it
  // moves there when you let go. Window listeners, since the row itself moves.
  const startDrag = (e, i) => {
    e.preventDefault();
    dragRef.current = { from: i, to: i };
    setDrag(dragRef.current);
    const move = (ev) => {
      const rows = [...listRef.current.children];
      let to = rows.length - 1;
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          to = k;
          break;
        }
      }
      if (to !== dragRef.current.to) {
        dragRef.current = { ...dragRef.current, to };
        setDrag(dragRef.current);
      }
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const { from, to } = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (from !== to) update((l) => wl.moved(l, from, to));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const q = query.trim().toLowerCase();
  const candidates = master.units.filter((u) =>
    (!q || u.name.toLowerCase().includes(q)) &&
    (rarity === "all" || u.rarity_guide === rarity) &&
    (!upcomingOnly || !upcoming || upcoming.has(u.uid)));

  return (
    <div className="wishlist">
      <div className="save-panel">
        <div className="wish-lists">
          <label>
            Wishlist
            <select value={wishes.open} onChange={(e) => setWishes((w) => ({ ...w, open: Number(e.target.value) }))}>
              {wishes.lists.map((l, i) => (
                <option key={i} value={i}>{l.name} ({l.units.length})</option>
              ))}
            </select>
          </label>
          <button className="small" onClick={newList}>＋ New list</button>
          <button className="small" onClick={rename}>Rename</button>
          <button className="small" onClick={remove}>Delete</button>
        </div>
        <div className="save-actions">
          <CopyButton text={() => shareLink(list)} label="Copy wishlist link" disabled={!list.units.length}
            title="Whoever opens it gets an exact copy of this wishlist" />
          <CopyButton text={() => wl.encodeList(list)} label="Copy wishlist code" disabled={!list.units.length} />
          <button onClick={() => setPasteOpen((v) => !v)}>Add a shared wishlist…</button>
          <span className="muted small">
            A link or code gives whoever opens it an exact copy of this list, next to their own.
          </span>
        </div>
        {pasteOpen && (
          <div className="paste-row">
            <input
              value={pasteVal}
              placeholder="paste a wishlist code or link"
              onChange={(e) => setPasteVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addShared()}
            />
            <button className="primary" onClick={addShared}>Add</button>
            <span className="muted small">Added as a new wishlist; yours stay as they are.</span>
          </div>
        )}
        {msg && <div className="small wish-msg">✅ {msg}</div>}
      </div>

      <div className="wish-ranking">
        <b>Rank paths by</b>
        {wl.RANKINGS.map((r) => (
          <label key={r.id}>
            <input type="radio" name="wish-ranking" checked={list.ranking === r.id}
              onChange={() => update((l) => wl.withRanking(l, r.id))} />
            {r.label}
          </label>
        ))}
        <span className="muted small">{rankHelp}</span>
      </div>

      {list.units.length === 0 ? (
        <p className="muted wish-empty">
          This wishlist is empty. Add units below: the Path Finder then looks for them (even ones you own), most
          wanted first.
        </p>
      ) : (
        <>
          <p className="muted small">
            Most wanted first: drag a unit by <b>⠿</b> or use the arrows. Units you untick in the Path Finder stay
            here but aren't searched.
          </p>
          <ol className="wish-list" ref={listRef}>
            {shownUnits.map((w, i) => {
              const unit = byUid.get(w.uid);
              if (!unit) return null;
              const where = upcoming?.get(w.uid);
              return (
                <li key={w.uid} className={`wish-row ${RARITY_CLASS[unit.rarity_guide] || ""} ${drag && drag.to === i ? "dragging" : ""} ${w.on ? "" : "off"}`}>
                  <span className="drag-handle" onPointerDown={(e) => startDrag(e, list.units.findIndex((x) => x.uid === w.uid))}
                    title="Drag to reorder">⠿</span>
                  <span className="wish-rank">#{i + 1}</span>
                  <UnitIcon unit={unit} className="wish-icon" />
                  <span className="wish-name">
                    {unit.name}
                    <span className="muted small"> · {unit.rarity_guide}</span>
                    {owned.has(unit.global_index) && <span className="tag">owned</span>}
                    {!w.on && <span className="tag">not searched</span>}
                  </span>
                  <span className="wish-where muted small" title={where ? [...where].join("\n") : ""}>
                    {upcoming === null ? "" : where ? `in ${where.size} Upcoming banner${where.size === 1 ? "" : "s"}` : "in no Upcoming banner"}
                  </span>
                  <span className="wish-buttons">
                    <button className="small" disabled={i === 0} onClick={() => update((l) => wl.moved(l, i, i - 1))}
                      title="Move up" aria-label={`Move ${unit.name} up`}>↑</button>
                    <button className="small" disabled={i === list.units.length - 1} onClick={() => update((l) => wl.moved(l, i, i + 1))}
                      title="Move down" aria-label={`Move ${unit.name} down`}>↓</button>
                    <button className="small" onClick={() => update((l) => wl.withoutUnit(l, w.uid))}
                      title="Take it off the list" aria-label={`Remove ${unit.name}`}>✕</button>
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="save-actions">
            <button className="primary" onClick={() => {
              setWishes((w) => wl.setEvery(w, false));
              onSearch();
            }}>
              Find paths for this wishlist →
            </button>
          </div>
        </>
      )}

      <h4 className="wish-add-head">Add units</h4>
      <div className="guide-toolbar">
        <div className="guide-search">
          <input type="search" value={query} placeholder="🔍 Search unit name…" onChange={(e) => setQuery(e.target.value)} />
          {query && <button className="small" onClick={() => setQuery("")}>clear</button>}
        </div>
        <label>
          Rarity
          <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
            <option value="all">All</option>
            {rarities.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label title="Units that the banners running now or coming up can give">
          <input type="checkbox" checked={upcomingOnly} onChange={(e) => setUpcomingOnly(e.target.checked)} />
          Only units in Upcoming banners
        </label>
        <span className="muted small">Click a unit to add it at the end of the list, or to take it off.</span>
      </div>
      {candidates.length === 0 && <p className="muted">No units match.</p>}
      <div className="grid">
        {candidates.map((u) => {
          const rank = rankOf.get(u.uid);
          return (
            <button
              key={u.uid}
              className={`tile ${rank ? "wished" : ""} ${RARITY_CLASS[u.rarity_guide] || ""}`}
              title={`${u.name} (${u.rarity_guide})${owned.has(u.global_index) ? " · owned" : ""}${rank ? ` · #${rank} on this list` : ""}`}
              onClick={() => update((l) => (rank ? wl.withoutUnit(l, u.uid) : wl.withUnit(l, u.uid)))}
            >
              {rank && <span className="wish-flag">#{rank}</span>}
              {owned.has(u.global_index) && <span className="owned-flag" title="owned">✓</span>}
              <UnitIcon unit={u} />
              <span className="tile-name">{u.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
