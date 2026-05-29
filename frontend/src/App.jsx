import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import TopBar from "./components/TopBar.jsx";
import CatGuide from "./components/CatGuide.jsx";
import PathFinder from "./components/PathFinder.jsx";
import ScreenshotImport from "./components/ScreenshotImport.jsx";

const TABS = [
  { id: "screenshot", label: "1 · Screenshot Import" },
  { id: "guide", label: "2 · Cat Guide" },
  { id: "paths", label: "3 · Path Finder" },
];

export default function App() {
  const [tab, setTab] = useState("guide");
  const [state, setState] = useState(null);
  const [master, setMaster] = useState(null);
  const [error, setError] = useState(null);

  const loadState = useCallback(async () => {
    try {
      setState(await api.state());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const loadMaster = useCallback(async () => {
    try {
      setMaster(await api.master());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadState();
    loadMaster();
  }, [loadState, loadMaster]);

  // Optimistically update owned flags in the loaded master without a full reload.
  const applyOwned = useCallback((indices, owned) => {
    setMaster((m) => {
      if (!m) return m;
      const set = new Set(indices);
      return {
        ...m,
        units: m.units.map((u) =>
          set.has(u.global_index) ? { ...u, owned } : u
        ),
      };
    });
  }, []);

  return (
    <div className="app">
      <TopBar state={state} reloadState={loadState} setError={setError} />
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
        {tab === "screenshot" && (
          <ScreenshotImport
            master={master}
            applyOwned={applyOwned}
            reloadState={loadState}
            goToGuide={() => setTab("guide")}
            setError={setError}
          />
        )}
        {tab === "guide" && (
          <CatGuide
            master={master}
            reloadMaster={loadMaster}
            applyOwned={applyOwned}
            reloadState={loadState}
            setError={setError}
          />
        )}
        {tab === "paths" && (
          <PathFinder
            state={state}
            master={master}
            applyOwned={applyOwned}
            reloadState={loadState}
            setError={setError}
          />
        )}
      </main>
    </div>
  );
}
