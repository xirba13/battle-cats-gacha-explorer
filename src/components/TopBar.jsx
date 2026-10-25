import React, { useMemo, useState } from "react";
import { normalize } from "../engine/names.js";

const RES_FIELDS = [
  { key: "rare_tickets", label: "Rare Tickets", img: "rare_ticket.png" },
  { key: "cat_food", label: "Cat Food", img: "cat_food.png" },
  { key: "platinum_tickets", label: "Platinum Tickets", img: "platinum_ticket.png" },
  { key: "legend_tickets", label: "Legend Tickets", img: "legend_ticket.png" },
];

export default function TopBar({
  region, seed, setSeed, resources, setResources, lastCat, setLastCat, units, ownedCount, disclaimer,
}) {
  const [showDisclaimer, setShowDisclaimer] = useState(true);

  return (
    <header className="topbar">
      <div className="topbar-row">
        <h1>🐾 Battle Cats Gacha Explorer</h1>
        <div className="region">
          <label>Region</label>
          <span className="region-name">{region}</span>
        </div>
        <div className="owned-count">Owned: <b>{ownedCount}</b></div>
      </div>

      <div className="topbar-row">
        <div className="seed">
          <label>Current Seed</label>
          <input
            value={seed}
            placeholder="enter your seed"
            onChange={(e) => setSeed(e.target.value.trim())}
          />
        </div>
        <LastCat lastCat={lastCat} setLastCat={setLastCat} units={units} />
        <div className="resources">
          {RES_FIELDS.map((f) => (
            <label key={f.key} title={f.label}>
              <img className="res-icon" src={`/top_icons/${f.img}`} alt={f.label} />
              <input
                type="number"
                min="0"
                value={resources[f.key]}
                onChange={(e) =>
                  setResources({ ...resources, [f.key]: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </label>
          ))}
        </div>
      </div>

      {showDisclaimer && disclaimer && (
        <div className="disclaimer" onClick={() => setShowDisclaimer(false)}>
          ⚠️ <b>Experimental.</b> {disclaimer} <i>(click to hide)</i>
        </div>
      )}
    </header>
  );
}

// The cat you pulled just before this seed. Only a Rare matters: if your next
// cat is the same Rare, the game rerolls it and you switch track. Filled in
// when you follow a path; type a name to set it, or clear it.
function LastCat({ lastCat, setLastCat, units }) {
  // While you type: your text (a known name sets the cat, anything else means
  // none). Otherwise the name of the cat that's set.
  const [draft, setDraft] = useState(null);
  const byName = useMemo(() => new Map((units || []).map((u) => [normalize(u.name), u.uid])), [units]);
  const rares = useMemo(() => (units || []).filter((u) => u.rarity_godfat === "Rare"), [units]);
  const name = lastCat === null ? "" : units?.find((u) => u.uid === lastCat)?.name ?? `#${lastCat}`;
  const change = (value) => {
    setDraft(value);
    setLastCat(byName.get(normalize(value)) ?? null);
  };
  const unknown = draft !== null && draft.trim() !== "" && !byName.has(normalize(draft));
  return (
    <div className="last-cat"
      title="The cat you pulled just before this seed: if your next cat is the same Rare, the game rerolls it and you switch track. It's filled in when you follow a path.">
      <label htmlFor="last-cat">Last cat</label>
      <input id="last-cat" list="rare-cats" value={draft ?? name} placeholder="none" className={unknown ? "unknown" : ""}
        onChange={(e) => change(e.target.value)} onBlur={() => setDraft(null)} />
      {lastCat !== null && (
        <button className="small clear" onClick={() => setLastCat(null)} title="No last cat" aria-label="Clear the last cat">✕</button>
      )}
      <datalist id="rare-cats">
        {rares.map((u) => <option key={u.uid} value={u.name} />)}
      </datalist>
    </div>
  );
}
