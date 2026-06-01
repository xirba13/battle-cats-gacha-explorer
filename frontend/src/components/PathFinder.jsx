import React, { useMemo, useRef, useState } from "react";
import { api } from "../api.js";

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

function CostLine({ cost }) {
  const parts = Object.entries(cost)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${RES_ICON[k] || ""} ${v} ${k.replace("_", " ")}`);
  return <span>{parts.length ? parts.join("  +  ") : "free"}</span>;
}

export default function PathFinder({
  master, owned, seed, setSeed, resources, setResources, applyOwned, replaceOwned, setError,
}) {
  const [events, setEvents] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [count, setCount] = useState(100);
  const [wishlist, setWishlist] = useState("");
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState(null);
  const [followMsg, setFollowMsg] = useState(null);
  const [lastSig, setLastSig] = useState(null);
  const resultsRef = useRef(null);

  const searchSig = useMemo(
    () => JSON.stringify({ seed, count, wishlist: wishlist.trim(), ids: [...selected].sort(), owned: owned.size }),
    [seed, count, wishlist, selected, owned]
  );
  const upToDate = result && lastSig === searchSig;

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
    try {
      const payload = {
        seed,
        event_ids: [...selected],
        count,
        resources,
        owned: [...owned],
        wishlist: wishlist.trim() ? wishlist.split(",").map((s) => s.trim()).filter(Boolean) : null,
      };
      setResult(await api.search(payload));
      setLastSig(searchSig);
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  };

  const followPath = async (sol) => {
    if (
      !window.confirm(
        "Mark every unit pulled along this path as owned, decrement your resources, " +
          "and fill in your new seed? Do this only after you have actually pulled in-game."
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
      let msg = res.new_seed
        ? `New seed filled in automatically: ${res.new_seed} — verify on godfat, then search again.`
        : "Path recorded.";
      msg += ` (+${res.units_added_count} new unit${res.units_added_count === 1 ? "" : "s"} owned)`;
      if (res.unmatched_units?.length)
        msg += ` · ${res.unmatched_units.length} unit(s) not in master`;
      setFollowMsg(msg);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="pathfinder">
      <div className="pf-controls">
        <div className="pf-seed">
          Seed: <b>{seed || <span className="muted">— set it in the top bar —</span>}</b>
        </div>
        <label>
          Depth (count)
          <input type="number" min="20" max="1000" value={count}
            onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <button disabled={!seed || loadingEvents} onClick={fetchEvents}>
          {loadingEvents ? "Fetching…" : "1 · Fetch Upcoming banners"}
        </button>
        <span className="muted small">godfat pages can be slow — results are cached per seed.</span>
      </div>

      {followMsg && <div className="follow-msg">✅ {followMsg}</div>}

      {events && (
        <div className="pf-banners">
          <h4>2 · Pick banners to search ({selected.size} selected)</h4>
          <p className="muted small">
            Each selected banner is fetched from godfat. Special banners are
            pre-selected when you have the matching tickets.
          </p>
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
          <div className="pf-run">
            <label>
              Wishlist (optional, comma-separated unit names)
              <input value={wishlist} placeholder="e.g. Balrog Cat, Vega Cat"
                onChange={(e) => setWishlist(e.target.value)} />
            </label>
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
          Fetching banners and computing paths… this can take a while on slow godfat days.
        </div>
      )}

      <div ref={resultsRef}>{result && <Results result={result} onFollow={followPath} />}</div>
    </div>
  );
}

function Results({ result, onFollow }) {
  const bannerName = (idx) => {
    const b = result.banners?.find((x) => x.index === idx);
    return b ? b.name : `banner ${idx + 1}`;
  };

  if (!result.targets.length)
    return (
      <div className="results">
        <p className="muted">
          No not-yet-owned target units found in the selected banners.
        </p>
      </div>
    );

  return (
    <div className="results">
      <h4>Results</h4>
      <p className="muted small">
        Targeting {result.targets.length} not-owned unit(s):{" "}
        {result.targets.slice(0, 12).join(", ")}
        {result.targets.length > 12 ? "…" : ""}
      </p>
      {result.unmatched?.length > 0 && (
        <p className="warn small">
          ⚠️ {result.unmatched.length} godfat name(s) had no master match: {result.unmatched.join(", ")}
        </p>
      )}
      {result.solutions.length === 0 && (
        <p className="muted">No path reaches any target within your resources.</p>
      )}
      {result.solutions.map((sol, i) => (
        <div key={i} className="solution">
          <div className="sol-head">
            <span className="sol-rank">#{i + 1}</span>
            <span className="sol-collected">
              🎯 {sol.collected_count} target(s): {sol.collected_units.join(", ")}
            </span>
            <span className="sol-cost">Cost: <CostLine cost={sol.cost} /></span>
            <span className={sol.verified ? "verified" : "unverified"}>
              {sol.verified ? "✓ verified" : "✗ UNVERIFIED"}
            </span>
            <button className="primary small" onClick={() => onFollow(sol)}>
              I followed this path
            </button>
          </div>
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
        </div>
      ))}
    </div>
  );
}

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
