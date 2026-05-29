import React, { useEffect, useState } from "react";
import { api } from "../api.js";

const RES_FIELDS = [
  { key: "rare_tickets", label: "Rare Tickets", icon: "🎫" },
  { key: "cat_food", label: "Cat Food", icon: "🍱" },
  { key: "platinum_tickets", label: "Platinum Tickets", icon: "🟣" },
  { key: "legend_tickets", label: "Legend Tickets", icon: "🌟" },
];

export default function TopBar({ state, reloadState, setError }) {
  const [seed, setSeed] = useState("");
  const [resources, setResources] = useState(null);
  const [showDisclaimer, setShowDisclaimer] = useState(true);

  useEffect(() => {
    if (state) {
      setSeed(state.seed || "");
      setResources(state.resources);
    }
  }, [state]);

  if (!state || !resources) return <header className="topbar">Loading…</header>;

  const saveSeed = async () => {
    try {
      await api.setSeed(seed || null);
      reloadState();
    } catch (e) {
      setError(e.message);
    }
  };

  const saveResources = async () => {
    try {
      await api.setResources(resources);
      reloadState();
    } catch (e) {
      setError(e.message);
    }
  };

  const changeRegion = async (region) => {
    try {
      await api.setRegion(region);
      reloadState();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-row">
        <h1>🐾 Battle Cats Path Tracker</h1>
        <div className="region">
          <label>Region</label>
          <select value={state.region} onChange={(e) => changeRegion(e.target.value)}>
            {state.regions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="owned-count">Owned: <b>{state.owned_count}</b></div>
      </div>

      <div className="topbar-row">
        <div className="seed">
          <label>Current Seed</label>
          <input
            value={seed}
            placeholder="enter your seed"
            onChange={(e) => setSeed(e.target.value)}
            onBlur={saveSeed}
            onKeyDown={(e) => e.key === "Enter" && saveSeed()}
          />
        </div>
        <div className="resources">
          {RES_FIELDS.map((f) => (
            <label key={f.key} title={f.label}>
              <span>{f.icon}</span>
              <input
                type="number"
                min="0"
                value={resources[f.key]}
                onChange={(e) =>
                  setResources({ ...resources, [f.key]: Number(e.target.value) })
                }
                onBlur={saveResources}
              />
            </label>
          ))}
        </div>
      </div>

      {showDisclaimer && (
        <div className="disclaimer" onClick={() => setShowDisclaimer(false)}>
          ⚠️ <b>Experimental.</b> {state.disclaimer} <i>(click to hide)</i>
        </div>
      )}
    </header>
  );
}
