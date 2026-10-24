import React, { useState } from "react";

const RES_FIELDS = [
  { key: "rare_tickets", label: "Rare Tickets", img: "rare_ticket.png" },
  { key: "cat_food", label: "Cat Food", img: "cat_food.png" },
  { key: "platinum_tickets", label: "Platinum Tickets", img: "platinum_ticket.png" },
  { key: "legend_tickets", label: "Legend Tickets", img: "legend_ticket.png" },
];

export default function TopBar({ region, seed, setSeed, resources, setResources, ownedCount, disclaimer }) {
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
