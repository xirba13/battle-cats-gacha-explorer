import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { decodeOwned, encodeOwned, readRawState, writeHash } from "./owncode.js";
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
  const [master, setMaster] = useState(null);
  const [error, setError] = useState(null);

  // All player state lives client-side and is mirrored to the URL hash. owned is
  // an (async-decoded) base64 code; seed + resources + tab parse synchronously.
  const raw0 = useRef(readRawState()).current;
  const [tab, setTab] = useState(
    TABS.some((t) => t.id === raw0.tab) ? raw0.tab : "guide"
  );
  const [owned, setOwnedState] = useState(new Set());
  const [seed, setSeed] = useState(raw0.seed);
  const [resources, setResources] = useState(raw0.resources);
  const [ownedCode, setOwnedCode] = useState(raw0.ownedCode);
  const ready = useRef(false);

  useEffect(() => {
    api.master().then(setMaster).catch((e) => setError(e.message));
  }, []);

  // Decode the owned set from the URL once on load, then enable URL writing.
  useEffect(() => {
    decodeOwned(raw0.ownedCode).then((set) => {
      setOwnedState(set);
      ready.current = true;
    });
  }, [raw0.ownedCode]);

  // Re-encode owned -> code whenever it changes (after the initial decode).
  useEffect(() => {
    if (!ready.current) return;
    encodeOwned(owned).then(setOwnedCode);
  }, [owned]);

  // Mirror state to the URL (the URL is the save file), including the active tab.
  useEffect(() => {
    if (!ready.current) return;
    writeHash({ ownedCode, seed, resources, tab });
  }, [ownedCode, seed, resources, tab]);

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
            ownedCode={ownedCode}
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
