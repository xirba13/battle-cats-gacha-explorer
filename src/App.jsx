import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { canSave, compareStates, hasData, loadSaved, save, savingOff, setSavingOff } from "./browserSave.js";
import { buildHash, decodeOwned, encodeOwned, readRawState, writeHash } from "./owncode.js";
import { decodePlan, encodePlan } from "./plancode.js";
import { decodeList, decodeWishes, emptyWishes, encodeList, encodeWishes, importList } from "./wishlists.js";
import TopBar from "./components/TopBar.jsx";
import CatGuide from "./components/CatGuide.jsx";
import Wishlist from "./components/Wishlist.jsx";
import PathFinder from "./components/PathFinder.jsx";
import Instructions from "./components/Instructions.jsx";

const TABS = [
  { id: "guide", label: "1 · Cat Guide" },
  { id: "wish", label: "2 · Wishlist" },
  { id: "paths", label: "3 · Path Finder" },
  { id: "help", label: "4 · Instructions" },
];

const REGION = "BCEN (English)";

// This page's address without its data, for links.
const pageUrl = () => `${window.location.origin}${window.location.pathname}`;

// Leave a shared plan for your own data (the page loads again with a new
// hash, so it reads your saved copy).
function reloadWith(hash) {
  history.replaceState(null, "", `${window.location.pathname}${hash}`);
  window.location.reload();
}

export default function App() {
  const [master, setMaster] = useState(null);
  const [error, setError] = useState(null);

  // All player state lives client-side: mirrored to the URL hash (the link is
  // the save file) and, unless turned off, saved in this browser. With no data
  // in the URL, the browser's copy is restored; a link whose data differs from
  // it asks which one to keep. A shared plan's link (v=1) opens read-only:
  // nothing is saved and the browser's copy is left alone. owned, the
  // wishlists and the plan are codes decoded once the Cat Guide list loads;
  // seed + resources + tab parse synchronously.
  const start = useRef(null);
  if (start.current === null) {
    const url = readRawState();
    const view = url.view;
    const saved = !view && canSave() && !savingOff() ? loadSaved() : null;
    const fromSaved = !view && !hasData(url) && saved !== null && hasData(saved);
    start.current = { url, saved, fromSaved, view, state: fromSaved ? { ...saved, tab: url.tab || saved.tab } : url };
  }
  const raw0 = start.current.state;
  const view = start.current.view;
  const [tab, setTab] = useState(
    TABS.some((t) => t.id === raw0.tab) ? raw0.tab : "guide"
  );
  const [owned, setOwnedState] = useState(new Set());
  const [seed, setSeed] = useState(raw0.seed);
  const [resources, setResources] = useState(raw0.resources);
  const [ownedCode, setOwnedCode] = useState(raw0.ownedCode);
  const [wishes, setWishes] = useState(emptyWishes);
  const [plan, setPlan] = useState(null);
  const [notice, setNotice] = useState(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(() => canSave() && !savingOff());
  // A link with other data than the browser's copy: {saved, savedOwned,
  // linkOwned} until the player picks one. Nothing is saved meanwhile.
  const [conflict, setConflict] = useState(null);

  const wishCode = useMemo(() => encodeWishes(wishes), [wishes]);
  const planCode = useMemo(() => (plan ? encodePlan(plan) : ""), [plan]);

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
    return { idToUid, uidToId, uids: new Set(uidToId.keys()) };
  }, [master]);

  // Decode the starting state once the master (uid map) is ready, compare a
  // link with the browser's copy, add a shared wishlist, then enable URL
  // writing and saving.
  useEffect(() => {
    if (!maps || ready) return undefined;
    let cancelled = false;
    const { url, saved, fromSaved, state } = start.current;
    (async () => {
      const set = await decodeOwned(state.ownedCode, maps.uidToId);
      let differs = null;
      if (!view && !fromSaved && saved && hasData(saved) && hasData(url)) {
        const cmp = await compareStates(url, saved, maps.uidToId);
        if (!cmp.same) differs = { saved, linkOwned: cmp.ownedA, savedOwned: cmp.ownedB };
      }
      if (cancelled) return;
      let w = decodeWishes(state.wishCode, maps.uids);
      // A wishlist link: an exact copy joins your lists.
      if (url.sharedWish && !view) {
        const list = decodeList(url.sharedWish, maps.uids);
        if (list) {
          const r = importList(w, list);
          w = r.wishes;
          setNotice(r.added
            ? `Added the shared wishlist “${r.name}” (${list.units.length} unit${list.units.length === 1 ? "" : "s"}) to your wishlists.`
            : `You already have the shared wishlist (“${r.name}”): it's open below.`);
          setTab("wish");
        } else {
          setError("That wishlist link is broken: check that it's complete.");
        }
      }
      setOwnedState(set);
      setWishes(w);
      setPlan(decodePlan(state.planCode));
      setConflict(differs);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [maps, ready, view]);

  // Re-encode owned -> code whenever it changes (after the initial decode).
  useEffect(() => {
    if (!ready || !maps) return;
    encodeOwned(owned, maps.idToUid).then(setOwnedCode);
  }, [owned, maps, ready]);

  // Mirror state to the URL (the URL is the save file), including the active
  // tab, and save it in this browser (not while a link waits for the choice,
  // nor for a shared plan).
  useEffect(() => {
    if (!ready) return;
    const state = { ownedCode, seed, resources, tab, wishCode, planCode };
    writeHash({ ...state, view });
    if (saving && !conflict && !view) save(state);
  }, [ready, ownedCode, seed, resources, tab, wishCode, planCode, saving, conflict, view]);

  // The link and the browser's copy differ: keep the link's data (it's then
  // saved), or switch to the saved data.
  const keepLink = useCallback(() => setConflict(null), []);
  const takeSaved = useCallback(() => {
    if (!conflict || !maps) return;
    setSeed(conflict.saved.seed);
    setResources(conflict.saved.resources);
    setOwnedCode(conflict.saved.ownedCode);
    setOwnedState(new Set(conflict.savedOwned));
    setWishes(decodeWishes(conflict.saved.wishCode, maps.uids));
    setPlan(decodePlan(conflict.saved.planCode));
    setConflict(null);
  }, [conflict, maps]);

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

  // Links to share: a plan opens read-only (everything here, with v=1); a
  // wishlist adds a copy of it to whoever opens it.
  const links = useMemo(() => ({
    plan: () => pageUrl() + buildHash({ ownedCode, seed, resources, tab: "paths", wishCode, planCode, view: true }),
    wishlist: (list) => `${pageUrl()}#wish=${encodeList(list)}`,
  }), [ownedCode, seed, resources, wishCode, planCode]);

  // From a shared plan: add its open wishlist to yours, or go to your data.
  const addSharedList = useCallback(() => reloadWith(`#wish=${encodeList(wishes.lists[wishes.open])}`), [wishes]);
  const leaveView = useCallback(() => reloadWith(""), []);

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
      {view && (
        <div className="view-banner">
          <div>
            <b>👀 You're looking at someone's shared plan.</b> Nothing here is saved in this browser, and your
            own collection, wishlists and plan stay as they are.
          </div>
          <div className="save-actions">
            <button className="primary" onClick={addSharedList} disabled={!ready || !wishes.lists[wishes.open]?.units.length}>
              Add their wishlist “{wishes.lists[wishes.open]?.name}” to mine
            </button>
            <button onClick={leaveView}>Go to my own data</button>
          </div>
        </div>
      )}
      {notice && (
        <div className="follow-msg" onClick={() => setNotice(null)}>
          ✅ {notice} <i className="small">(click to hide)</i>
        </div>
      )}
      {conflict && (
        <SavedConflict
          conflict={conflict}
          uids={maps?.uids}
          link={{
            owned: conflict.linkOwned, seed: start.current.url.seed, resources: start.current.url.resources,
            wishCode: start.current.url.wishCode, planCode: start.current.url.planCode,
          }}
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
        {/* The tabs stay mounted (hidden when not shown), so going to the
            Wishlist and back keeps the Path Finder's banners and results. */}
        <div hidden={tab !== "guide"}>
          <CatGuide
            master={master}
            owned={owned}
            ownedCode={ownedCode}
            toggleOwned={toggleOwned}
            onLoadCode={loadCode}
            setError={setError}
            saving={{ available: canSave(), enabled: saving, setEnabled: setSavingEnabled, view }}
          />
        </div>
        <div hidden={tab !== "wish"}>
          <Wishlist
            master={master}
            owned={owned}
            wishes={wishes}
            setWishes={setWishes}
            uids={maps?.uids}
            shareLink={links.wishlist}
            setError={setError}
            onSearch={() => setTab("paths")}
          />
        </div>
        <div hidden={tab !== "paths"}>
          <PathFinder
            master={master}
            owned={owned}
            seed={seed}
            setSeed={setSeed}
            resources={resources}
            setResources={setResources}
            replaceOwned={replaceOwned}
            wishes={wishes}
            setWishes={setWishes}
            plan={plan}
            setPlan={setPlan}
            planLink={links.plan}
            view={view}
            setError={setError}
            onEditWishlist={() => setTab("wish")}
          />
        </div>
        {tab === "help" && <Instructions disclaimer={master?.disclaimer} />}
      </main>
    </div>
  );
}

const describe = ({ owned, seed, resources: r, wishes, plan }) =>
  `${owned.size} units owned · seed ${seed || "none"} · ${r.rare_tickets} rare tickets, ` +
  `${r.cat_food} cat food, ${r.platinum_tickets} platinum, ${r.legend_tickets} legend · ` +
  `${wishes.lists.length} wishlist${wishes.lists.length === 1 ? "" : "s"} ` +
  `(${wishes.lists.reduce((n, l) => n + l.units.length, 0)} units)` +
  (plan ? ` · a plan saved ${plan.savedOn}` : "");

// Shown when the page was opened with a link whose data isn't what this
// browser saved, so an old bookmark or someone else's link can't silently
// replace the saved collection.
function SavedConflict({ conflict, link, uids, onKeepLink, onUseSaved }) {
  const { saved, savedOwned } = conflict;
  const when = saved.savedAt ? new Date(saved.savedAt).toLocaleString() : null;
  const full = (s) => ({ ...s, wishes: decodeWishes(s.wishCode, uids), plan: decodePlan(s.planCode) });
  return (
    <div className="saved-conflict">
      <div>
        <b>This link's data isn't the same as what this browser saved{when ? ` (${when})` : ""}.</b>{" "}
        Which do you want to keep? Until you choose, nothing is saved over this browser's copy.
      </div>
      <div className="small">Link: {describe(full(link))}</div>
      <div className="small">Saved: {describe(full({ ...saved, owned: savedOwned }))}</div>
      <div className="save-actions">
        <button className="primary" onClick={onKeepLink}>Keep the link's</button>
        <button onClick={onUseSaved}>Use the saved ones</button>
      </div>
    </div>
  );
}
