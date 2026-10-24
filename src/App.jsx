import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { canSave, compareStates, hasData, loadSaved, save, savingOff, setSavingOff } from "./browserSave.js";
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

  // All player state lives client-side: mirrored to the URL hash (the link is
  // the save file) and, unless turned off, saved in this browser. With no data
  // in the URL, the browser's copy is restored; a link whose data differs from
  // it asks which one to keep. owned is an (async-decoded) base64 code; seed +
  // resources + tab parse synchronously.
  const start = useRef(null);
  if (start.current === null) {
    const url = readRawState();
    const saved = canSave() && !savingOff() ? loadSaved() : null;
    const fromSaved = !hasData(url) && saved !== null && hasData(saved);
    start.current = { url, saved, fromSaved, state: fromSaved ? { ...saved, tab: url.tab || saved.tab } : url };
  }
  const raw0 = start.current.state;
  const [tab, setTab] = useState(
    TABS.some((t) => t.id === raw0.tab) ? raw0.tab : "guide"
  );
  const [owned, setOwnedState] = useState(new Set());
  const [seed, setSeed] = useState(raw0.seed);
  const [resources, setResources] = useState(raw0.resources);
  const [ownedCode, setOwnedCode] = useState(raw0.ownedCode);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(() => canSave() && !savingOff());
  // A link with other data than the browser's copy: {saved, savedOwned,
  // linkOwned} until the player picks one. Nothing is saved meanwhile.
  const [conflict, setConflict] = useState(null);

  useEffect(() => {
    api.master().then(setMaster).catch((e) => setError(e.message));
  }, []);

  // global_index <-> stable uid maps. The owned set keys on global_index
  // everywhere at runtime; these translate only at the URL boundary so shared
  // links survive future mid-guide insertions. Built once the master loads.
  const maps = useMemo(() => {
    if (!master) return null;
    const idToUid = new Map();
    const uidToId = new Map();
    for (const u of master.units) {
      idToUid.set(u.global_index, u.uid);
      uidToId.set(u.uid, u.global_index);
    }
    return { idToUid, uidToId };
  }, [master]);

  // Decode the starting owned set once the master (uid map) is ready, compare a
  // link with the browser's copy, then enable URL writing and saving.
  useEffect(() => {
    if (!maps || ready) return undefined;
    let cancelled = false;
    const { url, saved, fromSaved, state } = start.current;
    (async () => {
      const set = await decodeOwned(state.ownedCode, maps.uidToId);
      let differs = null;
      if (!fromSaved && saved && hasData(saved) && hasData(url)) {
        const cmp = await compareStates(url, saved, maps.uidToId);
        if (!cmp.same) differs = { saved, linkOwned: cmp.ownedA, savedOwned: cmp.ownedB };
      }
      if (cancelled) return;
      setOwnedState(set);
      setConflict(differs);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [maps, ready]);

  // Re-encode owned -> code whenever it changes (after the initial decode).
  useEffect(() => {
    if (!ready || !maps) return;
    encodeOwned(owned, maps.idToUid).then(setOwnedCode);
  }, [owned, maps, ready]);

  // Mirror state to the URL (the URL is the save file), including the active
  // tab, and save it in this browser (not while a link waits for the choice).
  useEffect(() => {
    if (!ready) return;
    writeHash({ ownedCode, seed, resources, tab });
    if (saving && !conflict) save({ ownedCode, seed, resources, tab });
  }, [ready, ownedCode, seed, resources, tab, saving, conflict]);

  // The link and the browser's copy differ: keep the link's data (it's then
  // saved), or switch to the saved data.
  const keepLink = useCallback(() => setConflict(null), []);
  const takeSaved = useCallback(() => {
    if (!conflict) return;
    setSeed(conflict.saved.seed);
    setResources(conflict.saved.resources);
    setOwnedCode(conflict.saved.ownedCode);
    setOwnedState(new Set(conflict.savedOwned));
    setConflict(null);
  }, [conflict]);

  // "Save in this browser": turning it off forgets the saved copy.
  const setSavingEnabled = useCallback((on) => {
    setSavingOff(!on);
    setSaving(on);
    if (!on) setConflict(null);
  }, []);

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

  // Decode a pasted code -> owned set (uid -> global_index via the master maps).
  // Returns how many known units it contained (0 => invalid/empty code).
  const loadCode = useCallback(
    async (code) => {
      if (!maps) return 0;
      const set = await decodeOwned(code, maps.uidToId);
      replaceOwned(set);
      return set.size;
    },
    [maps, replaceOwned]
  );

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
      {conflict && (
        <SavedConflict
          conflict={conflict}
          link={{ owned: conflict.linkOwned, seed: start.current.url.seed, resources: start.current.url.resources }}
          onKeepLink={keepLink}
          onUseSaved={takeSaved}
        />
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
            onLoadCode={loadCode}
            setError={setError}
            saving={{ available: canSave(), enabled: saving, setEnabled: setSavingEnabled }}
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

const describe = ({ owned, seed, resources: r }) =>
  `${owned.size} units owned · seed ${seed || "none"} · ${r.rare_tickets} rare tickets, ` +
  `${r.cat_food} cat food, ${r.platinum_tickets} platinum, ${r.legend_tickets} legend`;

// Shown when the page was opened with a link whose data isn't what this
// browser saved, so an old bookmark or someone else's link can't silently
// replace the saved collection.
function SavedConflict({ conflict, link, onKeepLink, onUseSaved }) {
  const { saved, savedOwned } = conflict;
  const when = saved.savedAt ? new Date(saved.savedAt).toLocaleString() : null;
  return (
    <div className="saved-conflict">
      <div>
        <b>This link's data isn't the same as what this browser saved{when ? ` (${when})` : ""}.</b>{" "}
        Which do you want to keep? Until you choose, nothing is saved over this browser's copy.
      </div>
      <div className="small">Link: {describe(link)}</div>
      <div className="small">Saved: {describe({ owned: savedOwned, seed: saved.seed, resources: saved.resources })}</div>
      <div className="save-actions">
        <button className="primary" onClick={onKeepLink}>Keep the link's</button>
        <button onClick={onUseSaved}>Use the saved ones</button>
      </div>
    </div>
  );
}
