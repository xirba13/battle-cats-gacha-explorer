import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { readStateFromHash, writeStateToHash } from "./owncode.js";
import TopBar from "./components/TopBar.jsx";
import CatGuide from "./components/CatGuide.jsx";
import PathFinder from "./components/PathFinder.jsx";
import Instructions from "./components/Instructions.jsx";

const TABS = [
  { id: "guide", label: "1 · Cat Guide" },
  { id: "paths", label: "2 · Path Finder" },
  { id: "help", label: "3 · Instructions" },
];

const REGION = "BCEN (English)";

export default function App() {
  const [tab, setTab] = useState("guide");
  const [master, setMaster] = useState(null);
  const [error, setError] = useState(null);

  // All player state lives client-side and is mirrored to the URL hash.
  const initial = readStateFromHash();
  const [owned, setOwnedState] = useState(initial.owned);
  const [seed, setSeed] = useState(initial.seed);
  const [resources, setResources] = useState(initial.resources);

  useEffect(() => {
    api.master().then(setMaster).catch((e) => setError(e.message));
  }, []);

  // Mirror state to the URL whenever it changes (the URL is the save file).
  useEffect(() => {
    writeStateToHash({ owned, seed, resources });
  }, [owned, seed, resources]);

  const toggleOwned = useCallback((index) => {
    setOwnedState((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }, []);

  // Add/remove many at once (screenshot is gone, but path-follow + paste use this).
  const applyOwned = useCallback((indices, isOwned) => {
    setOwnedState((prev) => {
      const next = new Set(prev);
      for (const i of indices) (isOwned ? next.add(i) : next.delete(i));
      return next;
    });
  }, []);

  const replaceOwned = useCallback((set) => setOwnedState(new Set(set)), []);

  return (
    <div className="app">
      <TopBar
        region={REGION}
        seed={seed}
        setSeed={setSeed}
        resources={resources}
        setResources={setResources}
        ownedCount={owned.size}
        disclaimer={master?.disclaimer}
      />
      {error && (
        <div className="error-bar" onClick={() => setError(null)}>
          ⚠️ {error} (click to dismiss)
        </div>
      )}
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === "guide" && (
          <CatGuide
            master={master}
            owned={owned}
            toggleOwned={toggleOwned}
            replaceOwned={replaceOwned}
            setError={setError}
          />
        )}
        {tab === "paths" && (
          <PathFinder
            master={master}
            owned={owned}
            seed={seed}
            setSeed={setSeed}
            resources={resources}
            setResources={setResources}
            applyOwned={applyOwned}
            replaceOwned={replaceOwned}
            setError={setError}
          />
        )}
        {tab === "help" && <Instructions disclaimer={master?.disclaimer} />}
      </main>
    </div>
  );
}
