import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SEARCH_TIME_LIMIT_MS, api } from "../api.js";
import { localToday } from "../engine/data.js";
import { stepsOf } from "../engine/pathfinder.js";
import { MAX_COUNT, autoDepth, planOf } from "../engine/services.js";
import * as wl from "../wishlists.js";
import CopyButton from "./CopyButton.jsx";
import TrackTable from "./TrackTable.jsx";
import UnitIcon from "./UnitIcon.jsx";

const TYPE_BADGE = {
  normal: { label: "Normal", cls: "b-normal" },
  platinum: { label: "Platinum", cls: "b-plat" },
  legend: { label: "Legend", cls: "b-legend" },
};

const RES_ICON = {
  rare_tickets: "🎫",
  cat_food: "🍱",
  platinum_tickets: "🟣",
  legend_tickets: "🌟",
};

// Days since the banner data was built (by the daily data job).
function dataDaysOld(dataInfo) {
  if (!dataInfo?.built_on) return 0;
  return Math.floor((Date.now() - Date.parse(`${dataInfo.built_on}T00:00:00`)) / 86_400_000);
}

function CostLine({ cost }) {
  const parts = Object.entries(cost)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${RES_ICON[k] || ""} ${v} ${k.replace("_", " ")}`);
  return <span>{parts.length ? parts.join("  +  ") : "free"}</span>;
}

// Which search a path came from, and its pulls: to tell whether it's the
// saved plan.
const pathSig = (seed, events, steps) => `${seed}|${events.join(",")}|${steps.join(",")}`;

export default function PathFinder({
  master, owned, seed, setSeed, resources, setResources, replaceOwned, wishes, setWishes, plan, setPlan, planLink,
  view, setError, onEditWishlist,
}) {
  const [events, setEvents] = useState(null);
  const [dataInfo, setDataInfo] = useState(null);
  const [selected, setSelected] = useState(new Set());
  // Table depth: as deep as your resources can pull (so the best paths can use
  // them all), unless you type your own number ("" while you're typing one).
  const [depthTyped, setDepthTyped] = useState(null);
  const autoCount = useMemo(() => autoDepth(resources), [resources]);
  const count = depthTyped === null || depthTyped === "" ? autoCount : Math.min(MAX_COUNT, Math.max(20, depthTyped));
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState(null);
  const [followMsg, setFollowMsg] = useState(null);
  // After following a path: the wishlists holding units it pulled, to offer
  // taking them off ([{index, name, uids}]).
  const [offer, setOffer] = useState(null);
  const [lastSig, setLastSig] = useState(null);
  const [progress, setProgress] = useState(null);
  // The saved plan, built again for showing (null while it's built).
  const [planView, setPlanView] = useState(null);
  const [planOpen, setPlanOpen] = useState(true);
  const resultsRef = useRef(null);
  // The running search, stopped if the page goes away.
  const searchAbort = useRef(null);
  useEffect(() => () => searchAbort.current?.abort(), []);

  // The wishlist to search: the open one, unless "every unit you don't own".
  // With nothing ticked, the search looks for every unit you don't own too.
  const list = wishes.every ? null : wishes.lists[wishes.open];
  const wish = list && list.units.some((u) => u.on) ? { units: list.units, ranking: list.ranking } : null;
  const byUid = useMemo(() => new Map((master?.units || []).map((u) => [u.uid, u])), [master]);

  const searchSig = useMemo(
    () => JSON.stringify({ seed, count, wish, ids: [...selected].sort(), owned: owned.size }),
    [seed, count, wish, selected, owned]
  );
  const upToDate = result && lastSig === searchSig;

  const planSig = plan ? pathSig(plan.seed, plan.events, plan.steps) : null;
  useEffect(() => {
    setPlanView(null);
    if (!plan) return undefined;
    let cancelled = false;
    api.plan(plan)
      .then((v) => !cancelled && setPlanView(v))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [plan, setError]);

  // A path's wishlist places (#1…) by godfat name: a search result says them;
  // for the saved plan, they're looked up in the open wishlist.
  const planRanks = useMemo(() => {
    if (!planView?.target_uids) return null;
    const open = wishes.lists[wishes.open];
    const ranks = {};
    for (const [name, uid] of Object.entries(planView.target_uids)) {
      const i = open.units.findIndex((u) => u.uid === uid);
      if (i >= 0) ranks[name] = i + 1;
    }
    return ranks;
  }, [planView, wishes]);

  const fetchEvents = async () => {
    if (!seed) {
      setError("Enter your seed in the top bar first.");
      return;
    }
    setLoadingEvents(true);
    setResult(null);
    try {
      const data = await api.events(seed, count);
      setEvents(data.events);
      setDataInfo(data.data || null);
      const pre = new Set();
      for (const ev of data.events) {
        if (ev.banner_type === "platinum" && resources.platinum_tickets > 0) pre.add(ev.event_id);
        if (ev.banner_type === "legend" && resources.legend_tickets > 0) pre.add(ev.event_id);
      }
      setSelected(pre);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingEvents(false);
    }
  };

  const toggleSel = (id) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const runSearch = async () => {
    if (selected.size === 0) {
      setError("Select at least one banner to search.");
      return;
    }
    setSearching(true);
    setResult(null);
    setFollowMsg(null);
    setOffer(null);
    setProgress(null);
    setPlanOpen(false);
    const controller = new AbortController();
    searchAbort.current = controller;
    try {
      const payload = {
        seed,
        event_ids: [...selected],
        count,
        resources,
        owned: [...owned],
        wish,
      };
      setResult(await api.search(payload, { onProgress: setProgress, signal: controller.signal }));
      setLastSig(searchSig);
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      if (searchAbort.current === controller) searchAbort.current = null;
      setSearching(false);
    }
  };

  const savePlan = (sol) => {
    if (plan && !window.confirm("Replace your saved plan with this path?")) return;
    setPlan({ ...planOf(result, sol), savedOn: localToday() });
    setPlanOpen(false);
  };

  const followPath = async (sol) => {
    if (
      !window.confirm(
        "Mark every unit pulled along this path as owned, decrement your resources, " +
          "and fill in your new seed? Do this only after you have actually pulled in-game." +
          (plan ? " Your saved plan is cleared too (it starts from your old seed)." : "")
      )
    )
      return;
    try {
      const res = await api.followed(sol, [...owned], resources);
      replaceOwned(new Set(res.owned));
      if (res.resources) setResources(res.resources);
      setSeed(res.new_seed || "");
      setResult(null);
      setEvents(null);
      setSelected(new Set());
      setPlan(null);
      let msg = res.new_seed
        ? `New seed filled in automatically: ${res.new_seed} — verify on godfat, then search again.`
        : "Path recorded.";
      msg += ` (+${res.units_added_count} new unit${res.units_added_count === 1 ? "" : "s"} owned)`;
      if (res.unmatched_units?.length)
        msg += ` · ${res.unmatched_units.length} unit(s) not in master`;
      setFollowMsg(msg);
      const held = wl.listsWith(wishes, res.pulled_uids || []);
      setOffer(held.length ? held : null);
    } catch (e) {
      setError(e.message);
    }
  };

  const takeOff = () => {
    setWishes((w) => wl.removeEverywhere(w, offer.flatMap((x) => x.uids)));
    setOffer(null);
  };

  const setSearchFor = (value) => setWishes((w) => (value === "every" ? wl.setEvery(w, true) : wl.openList(w, Number(value))));
  const changeList = (fn) => setWishes((w) => wl.changeOpen(w, fn));

  return (
    <div className="pathfinder">
      <div className="pf-controls">
        <div className="pf-seed">
          Seed: <b>{seed || <span className="muted">— set it in the top bar —</span>}</b>
        </div>
        <label>
          Depth (rows){depthTyped === null ? " · auto" : ""}
          <input type="number" min="20" max={MAX_COUNT} value={depthTyped ?? autoCount}
            title="How far down the roll tables go. Auto: as deep as your resources can pull."
            onChange={(e) => setDepthTyped(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        {depthTyped !== null && (
          <button className="small" onClick={() => setDepthTyped(null)}
            title="As deep as your resources can pull">
            Auto ({autoCount})
          </button>
        )}
        <button disabled={!seed || loadingEvents} onClick={fetchEvents}>
          {loadingEvents ? "Fetching…" : "1 · Fetch Upcoming banners"}
        </button>
        <span className="muted small">Everything is computed in your browser from godfat's open data.</span>
      </div>

      {followMsg && <div className="follow-msg">✅ {followMsg}</div>}
      {offer && (
        <div className="saved-conflict">
          <div>
            This path pulled units on your wishlist{offer.length === 1 ? "" : "s"}:{" "}
            {offer.map((x) => `“${x.name}”: ${x.uids.map((u) => byUid.get(u)?.name ?? `#${u}`).join(", ")}`).join("; ")}.
            Take them off? Keep them if you want more copies.
          </div>
          <div className="save-actions">
            <button className="primary" onClick={takeOff}>Take them off</button>
            <button onClick={() => setOffer(null)}>Keep them</button>
          </div>
        </div>
      )}

      {plan && (
        <PlanCard
          plan={plan}
          planView={planView}
          ranks={planRanks}
          seed={seed}
          open={planOpen}
          setOpen={setPlanOpen}
          view={view}
          planLink={planLink}
          onFollow={followPath}
          onRemove={() => window.confirm("Remove your saved plan?") && setPlan(null)}
        />
      )}

      {events && (
        <div className="pf-banners">
          <h4>2 · Pick banners to search ({selected.size} selected)</h4>
          <p className="muted small">
            Banners and their pools come from godfat's open data
            {dataInfo?.built_on ? ` (our copy from ${dataInfo.built_on})` : ""}. Special banners are
            pre-selected when you have the matching tickets.
          </p>
          {dataDaysOld(dataInfo) > 3 && (
            <p className="warn small">
              ⚠️ This banner data is {dataDaysOld(dataInfo)} days old (it's normally updated every day), so
              the newest banners may be missing.
            </p>
          )}
          <div className="banner-list">
            {events.map((ev) => {
              const badge = TYPE_BADGE[ev.banner_type] || TYPE_BADGE.normal;
              return (
                <label key={ev.event_id} className="banner-row">
                  <input type="checkbox" checked={selected.has(ev.event_id)} onChange={() => toggleSel(ev.event_id)} />
                  <span className={`badge ${badge.cls}`}>{badge.label}</span>
                  <span className="banner-dates muted small">{ev.date_start} → {ev.date_end}</span>
                  <span className="banner-desc">{ev.description}</span>
                </label>
              );
            })}
          </div>

          <div className="pf-targets">
            <div className="pf-targets-head">
              <label>
                Search for
                <select value={wishes.every ? "every" : String(wishes.open)} onChange={(e) => setSearchFor(e.target.value)}>
                  {wishes.lists.map((l, i) => (
                    <option key={i} value={String(i)}>
                      Wishlist: {l.name} ({l.units.filter((u) => u.on).length} of {l.units.length} ticked)
                    </option>
                  ))}
                  <option value="every">Every unit you don't own</option>
                </select>
              </label>
              {list && (
                <label title={wl.RANKINGS.find((r) => r.id === list.ranking)?.help}>
                  Rank paths by
                  <select value={list.ranking} onChange={(e) => changeList((l) => wl.withRanking(l, e.target.value))}>
                    {wl.RANKINGS.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                </label>
              )}
              {list && <button className="small" onClick={onEditWishlist}>Edit the wishlist</button>}
            </div>
            {list && <p className="muted small">{wl.RANKINGS.find((r) => r.id === list.ranking)?.help}</p>}
            {list && list.units.length > 0 && (
              <WishChecklist list={list} byUid={byUid} owned={owned} events={events} selected={selected}
                onTick={(uid, on) => changeList((l) => wl.withTick(l, uid, on))}
                onTickAll={(on) => changeList((l) => wl.withAllTicked(l, on))} />
            )}
            {list && !wish && (
              <p className="muted small">
                {list.units.length ? "Nothing ticked" : "This wishlist is empty"}: the search looks for every unit
                you don't own.
              </p>
            )}
          </div>

          <div className="pf-run">
            <button className="primary" disabled={searching || upToDate} onClick={runSearch}>
              {searching
                ? "Searching… (may take a while)"
                : upToDate
                ? "✓ Paths shown below — change a banner or the wishlist to search again"
                : "3 · Find optimal paths"}
            </button>
          </div>
        </div>
      )}

      {searching && (
        <div className="loading">
          Computing paths…{" "}
          {progress
            ? `${progress.steps.toLocaleString()} states checked (${Math.round(progress.ms / 1000)} s).`
            : ""}{" "}
          Many banners or lots of resources take longer; it stops after {SEARCH_TIME_LIMIT_MS / 1000} s
          with the best paths found so far.
        </div>
      )}

      <div ref={resultsRef}>
        {result && (
          <Results result={result} onFollow={followPath} onSave={savePlan} view={view}
            savedSig={planSig} />
        )}
      </div>
    </div>
  );
}

// The open wishlist's units, ticked or not for the search, with the picked
// banners that can give each one.
function WishChecklist({ list, byUid, owned, events, selected, onTick, onTickAll }) {
  const picked = events.map((ev, i) => ({ ...ev, n: i + 1 })).filter((ev) => selected.has(ev.event_id));
  return (
    <>
      <ul className="pf-wish">
        {list.units.map((w, i) => {
          const unit = byUid.get(w.uid);
          if (!unit) return null;
          const inBanners = picked.filter((ev) => ev.uids.includes(w.uid));
          return (
            <li key={w.uid} className={w.on ? "" : "off"}>
              <label>
                <input type="checkbox" checked={w.on} onChange={(e) => onTick(w.uid, e.target.checked)} />
                <span className="wish-rank">#{i + 1}</span>
                <UnitIcon unit={unit} className="wish-icon" />
                <span>{unit.name}</span>
                {owned.has(unit.global_index) && <span className="tag">owned</span>}
                <span className={inBanners.length ? "muted small" : "warn small"}
                  title={inBanners.map((ev) => ev.description).join("\n")}>
                  {inBanners.length
                    ? `in ${inBanners.length} picked banner${inBanners.length === 1 ? "" : "s"}`
                    : "not in the picked banners"}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="save-actions">
        <button className="small" onClick={() => onTickAll(true)}>Tick all</button>
        <button className="small" onClick={() => onTickAll(false)}>Untick all</button>
      </div>
    </>
  );
}

// A path's title: the targets it gets and its cost. Wishlist units come in
// the wishlist's order, with their places.
function PathTitle({ sol, ranks }) {
  const units = ranks
    ? [...sol.collected_units].sort((a, b) => (ranks[a] ?? Infinity) - (ranks[b] ?? Infinity))
    : sol.collected_units;
  const named = units.map((u) => (ranks?.[u] ? `#${ranks[u]} ${u}` : u));
  return (
    <>
      <span className="sol-collected">
        🎯 {sol.collected_count} target(s): {named.join(", ")}
      </span>
      <span className="sol-cost">Cost: <CostLine cost={sol.cost} /></span>
    </>
  );
}

// A path's pulls, step by step.
function PathSteps({ sol, bannerName }) {
  return (
    <>
      <ol className="sol-steps">
        {sol.actions.map((a, j) => (
          <li key={j} className={a.targets_hit.length ? "hit" : ""}>
            <b>{actionLabel(a)}</b> on{" "}
            <span className="banner-ref" title={bannerName(a.banner_index)}>
              {bannerName(a.banner_index)}
            </span>{" "}
            ({a.position_from} → {a.position_to})
            {a.units_pulled.length > 1 ? (
              <span className="draw"> — {a.units_pulled.join(", ")}</span>
            ) : (
              <span className="draw"> — {a.units_pulled[0]}</span>
            )}
            {a.targets_hit.length > 0 && (
              <span className="target-tag"> 🎯 {a.targets_hit.join(", ")}</span>
            )}
          </li>
        ))}
      </ol>
      <div className="muted small">
        Final seed position: {sol.final_position}
        {sol.final_seed && <> · resulting seed: <b>{sol.final_seed}</b></>}
      </div>
    </>
  );
}

const nameOfBanner = (result) => (idx) => {
  const b = result.banners?.find((x) => x.index === idx);
  return b ? b.name : `banner ${idx + 1}`;
};

const PLAN_PROBLEM = {
  gone: "One of its banners is over (it's no longer in the banner data), so it can't be shown any more. Remove it and search again.",
  broken: "It no longer fits the roll tables (the banner data changed), so it can't be shown. Remove it and search again.",
  changed: "The banner data changed since you saved it, so these pulls may not give what they did: check them, or search again.",
};

// Your saved plan: kept in the page URL and this browser until you follow or
// remove it, built again from its seed, banners and pulls (no search).
function PlanCard({ plan, planView, ranks, seed, open, setOpen, view, planLink, onFollow, onRemove }) {
  const sol = planView?.solutions?.[0] ?? null;
  return (
    <div className="solution selected plan-card">
      <button className="sol-head sol-pick plan-toggle" onClick={() => setOpen(!open)}
        title={open ? "Hide its pulls and table" : "Show its pulls and table"}>
        <span className="sol-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="sol-rank">📌 {view ? "Their plan" : "Your plan"}</span>
        {sol ? <PathTitle sol={sol} ranks={ranks} /> : <span className="muted">{planView ? "" : "Loading…"}</span>}
      </button>
      <div className="muted small plan-meta">
        Saved {plan.savedOn} · seed {plan.seed} · {plan.events.length} banner{plan.events.length === 1 ? "" : "s"},{" "}
        {plan.depth} rows · {plan.steps.length} step{plan.steps.length === 1 ? "" : "s"}
      </div>
      {planView?.problem && <p className="warn small">⚠️ {PLAN_PROBLEM[planView.problem]}</p>}
      {!view && seed && plan.seed !== seed && (
        <p className="warn small">⚠️ This plan starts from seed {plan.seed}, but your seed is now {seed}.</p>
      )}
      {!view && (
        <div className="save-actions">
          <CopyButton text={planLink} label="Share plan (read-only)"
            title="A link for a friend: it opens this plan (with your collection and wishlists) read-only, and saves nothing in their browser" />
          <CopyButton text={() => window.location.href} label="Copy link for my other devices"
            title="Your whole save (collection, wishlists, this plan, seed and resources): open it on another device to carry on there" />
          {sol && (
            <button className="primary" onClick={() => onFollow(sol)}>I followed this path</button>
          )}
          <button onClick={onRemove}>Remove plan</button>
        </div>
      )}
      {open && sol && (
        <>
          <PathSteps sol={sol} bannerName={nameOfBanner(planView)} />
          <TrackTable result={planView} path={sol} ranks={ranks} />
        </>
      )}
    </div>
  );
}

function Results({ result, onFollow, onSave, view, savedSig }) {
  // The selected path shows its steps and is drawn on the track table; the
  // others show only their title. A new search starts at the best one.
  const [picked, setPicked] = useState({ result: null, index: 0 });
  const pathIndex = picked.result === result ? picked.index : 0;
  // Opening a path closes the one that was open, maybe above it: keep the
  // clicked title where it was on screen instead of letting it jump.
  const cards = useRef([]);
  const anchor = useRef(null);
  const pick = (i) => {
    anchor.current = { i, top: cards.current[i]?.getBoundingClientRect().top };
    setPicked({ result, index: i });
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const el = a && cards.current[a.i];
    if (el && a.top != null) window.scrollBy(0, el.getBoundingClientRect().top - a.top);
  }, [pathIndex]);
  const ranks = result.wish_ranks;
  const table = result.banners?.some((b) => b.rolls) && (
    <TrackTable result={result} path={result.solutions[pathIndex] ?? null} ranks={ranks} />
  );

  if (!result.targets.length)
    return (
      <div className="results">
        <p className="muted">
          {result.wishlist
            ? "None of the ticked wishlist units are in the selected banners."
            : "No not-yet-owned target units found in the selected banners."}
        </p>
        {table}
      </div>
    );

  return (
    <div className="results">
      <h4>Results</h4>
      <p className="muted small">
        Targeting {result.targets.length} {result.wishlist ? "unit(s) from your wishlist" : "not-owned unit(s)"}:{" "}
        {result.targets.slice(0, 12).map((u) => (ranks?.[u] ? `#${ranks[u]} ${u}` : u)).join(", ")}
        {result.targets.length > 12 ? "…" : ""}
        {result.wishlist && ` · paths ranked by: ${wl.RANKINGS.find((r) => r.id === result.ranking)?.label}`}
      </p>
      {result.unmatched?.length > 0 && (
        <p className="warn small">
          ⚠️ {result.unmatched.length} godfat name(s) had no master match: {result.unmatched.join(", ")}
        </p>
      )}
      {result.search?.stopped && (
        <p className="warn small">
          ⏱️ The search stopped early ({STOPPED[result.search.stopped] || result.search.stopped}) and shows
          the best paths it found; cheaper ones may exist. Fewer banners or a wishlist let it finish.
        </p>
      )}
      {result.solutions.length === 0 && (
        <p className="muted">No path reaches any target within your resources.</p>
      )}
      {result.solutions.map((sol, i) => {
        const open = i === pathIndex;
        const isPlan = savedSig === pathSig(result.seed, result.event_ids, stepsOf(sol));
        const title = (
          <>
            <span className="sol-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
            <span className="sol-rank">#{i + 1}</span>
            <PathTitle sol={sol} ranks={ranks} />
            {isPlan && <span className="plan-tag">📌 your plan</span>}
          </>
        );
        if (!open)
          return (
            <div key={i} ref={(el) => (cards.current[i] = el)} className="solution collapsed">
              <button className="sol-head sol-pick" onClick={() => pick(i)}
                title="Show this path's steps and draw it on the track table">
                {title}
              </button>
            </div>
          );
        return (
          <div key={i} ref={(el) => (cards.current[i] = el)} className="solution selected">
            <div className="sol-head">
              {title}
              <span className="on-table">shown on the table ↓</span>
              {!view && !isPlan && (
                <button className="small" onClick={() => onSave(sol)}
                  title="Keep this path (in the page URL and this browser) until you follow it, and share it">
                  📌 Save as my plan
                </button>
              )}
              {!view && (
                <button className="primary small" onClick={() => onFollow(sol)}>
                  I followed this path
                </button>
              )}
            </div>
            <PathSteps sol={sol} bannerName={nameOfBanner(result)} />
          </div>
        );
      })}
      {table}
    </div>
  );
}

// Why a search stopped before exploring everything.
const STOPPED = {
  steps: "after 1.5 million steps",
  time: `after ${SEARCH_TIME_LIMIT_MS / 1000} seconds`,
  states: "to save memory",
};

function actionLabel(a) {
  switch (a.action_type) {
    case "guaranteed_11":
      return "Guaranteed 11-draw";
    case "multi_11":
      return "11-roll (multi)";
    case "platinum":
      return "Platinum pull";
    case "legend":
      return "Legend pull";
    default:
      return a.payment === "cat_food" ? "Single pull (food)" : "Single pull (ticket)";
  }
}
