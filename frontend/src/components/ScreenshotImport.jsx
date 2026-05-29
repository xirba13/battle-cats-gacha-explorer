import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import UnitIcon from "./UnitIcon.jsx";

// Section 1: upload Cat Guide screenshots, detect locked/unlocked per slot,
// and push the results into the Cat Guide (Section 2) for the user to confirm.
export default function ScreenshotImport({ master, applyOwned, reloadState, goToGuide, setError }) {
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [file, setFile] = useState(null);

  const pageCount = master?.meta?.pages || 33;

  const detected = result?.cells || [];
  const summary = useMemo(() => {
    const unlocked = detected.filter((c) => c.state === "unlocked").length;
    return { unlocked, locked: detected.length - unlocked, total: detected.length };
  }, [detected]);

  const onUpload = async () => {
    if (!file) {
      setError("Choose a screenshot first.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.screenshot(file, page);
      setResult(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Apply detected unlocked tiles as owned (and locked as not-owned) to the DB.
  const applyDetection = async (mode) => {
    const ownIdx = detected
      .filter((c) => c.state === "unlocked" && c.global_index != null)
      .map((c) => c.global_index);
    const lockIdx = detected
      .filter((c) => c.state === "locked" && c.global_index != null)
      .map((c) => c.global_index);
    try {
      if (ownIdx.length) {
        await api.bulkOwned(ownIdx, true);
        applyOwned(ownIdx, true);
      }
      if (mode === "both" && lockIdx.length) {
        await api.bulkOwned(lockIdx, false);
        applyOwned(lockIdx, false);
      }
      await reloadState();
      goToGuide();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="screenshot-import">
      <div className="ss-instructions">
        <h3>Import from screenshots</h3>
        <p className="critical">
          ⚠️ Screenshot the in-game Cat Guide with <b>NO filter applied</b> (default
          view). With a filter on, the slot order won&apos;t match and detection
          will be wrong.
        </p>
        <p className="muted small">
          Detection only classifies each cell as <b>unlocked</b> (you own it) vs{" "}
          <b>locked</b> (the gray “?” box) — the slot position already determines
          which unit it is. Upload pages <b>in order</b> and set the page number.
          Then confirm/fix the results in the Cat Guide tab (one click each).
        </p>
        <p className="notice">
          ℹ️ Detection is <b>not perfect</b>. Always review the results — you can
          also add or mark any unit as owned/locked <b>manually in the Cat Guide</b>{" "}
          by clicking its tile, with or without using screenshots at all.
        </p>
      </div>

      <div className="ss-controls">
        <label>
          Page #
          <input
            type="number"
            min="1"
            max={pageCount}
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
          />
        </label>
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0])} />
        <button className="primary" disabled={busy} onClick={onUpload}>
          {busy ? "Detecting…" : "Detect"}
        </button>
        {result && (
          <button onClick={() => { setPage((p) => Math.min(pageCount, p + 1)); setResult(null); setFile(null); }}>
            Next page →
          </button>
        )}
      </div>

      {result && (
        <div className="ss-result">
          <p>
            Detected <b>{summary.total}</b> tiles on page {result.page}:{" "}
            <span className="ok">{summary.unlocked} unlocked</span> ·{" "}
            <span className="muted">{summary.locked} locked</span>
          </p>
          {result.notes?.map((n, i) => (
            <p key={i} className="warn small">⚠️ {n}</p>
          ))}

          <div className="ss-grid">
            {detected.map((c) => (
              <div
                key={c.slot}
                className={"ss-cell " + (c.state === "unlocked" ? "u" : "l")}
                title={`slot ${c.slot}: ${c.name || "?"} — ${c.state}`}
              >
                {c.icon || c.icon_url ? <UnitIcon unit={c} /> : <span>?</span>}
                <span className="ss-state">{c.state === "unlocked" ? "✓" : "🔒"}</span>
                <span className="ss-name">{c.name || `slot ${c.slot}`}</span>
              </div>
            ))}
          </div>

          <div className="ss-apply">
            <button className="primary" onClick={() => applyDetection("both")}>
              Apply (mark unlocked owned, locked not-owned) → Cat Guide
            </button>
            <button onClick={() => applyDetection("own")}>
              Only add unlocked as owned
            </button>
            <span className="muted small">
              You can still fix any mistake with one click in the Cat Guide.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
