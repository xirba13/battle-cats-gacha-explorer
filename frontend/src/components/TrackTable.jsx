import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// godfat-style roll tables for the searched banners: track A on the left, B on
// the right, B half a roll lower. Built as ONE table of half-rows: every
// position spans two, A positions start on even half-rows and B positions on
// odd ones, so the tracks interleave (1A, 1B, 2A, 2B…) and stay aligned.
//
// Every half-row is exactly HALF_ROW px tall (styles.css reads it from the
// --half-row variable), so only the half-rows near the visible part are drawn
// and spacer rows stand in for the rest: deep tables stay fast. Columns have
// fixed widths so they don't jump while scrolling.
const HALF_ROW = 19;
const BUFFER = 40; // half-rows drawn above and below the visible part
const POS_WIDTH = 56;

const RARITY_CLASS = {
  Normal: "rar-normal",
  Special: "rar-special",
  Rare: "rar-rare",
  "Super Rare": "rar-super",
  "Uber Rare": "rar-uber",
  "Legend Rare": "rar-legend",
};

// Half-row of a position ("1A" -> 0, "1B" -> 1, "2A" -> 2…) and back.
const halfRow = (pos) => 2 * (parseInt(pos, 10) - 1) + (pos.endsWith("B") ? 1 : 0);
const posLabel = (h) => `${(h >> 1) + 1}${h % 2 ? "B" : "A"}`;

// Column width from the longest text it shows (dupe lines use a smaller font).
function columnWidth(banner, kind) {
  let longest = 0;
  for (const e of Object.values(banner.rolls)) {
    const main = kind === "guaranteed" ? e.guaranteed_unit && `${e.guaranteed_unit} → 99B` : e.unit;
    const alt = kind === "guaranteed" ? e.alt_guaranteed_unit : e.alt_unit;
    if (main) longest = Math.max(longest, main.length * 7.1);
    if (alt) longest = Math.max(longest, (alt.length + 11) * 6.1);
  }
  return Math.round(Math.min(240, Math.max(110, longest + 20)));
}

export default function TrackTable({ result, path }) {
  const banners = result.banners;
  // Columns per track: each banner's roll, plus its 11-draw column when it's a
  // guaranteed banner (like godfat's table).
  const cols = useMemo(() => {
    const out = [];
    banners.forEach((b, j) => {
      out.push({ j, kind: "unit", width: columnWidth(b, "unit") });
      if (Object.values(b.rolls).some((e) => e.guaranteed_unit)) {
        out.push({ j, kind: "guaranteed", width: columnWidth(b, "guaranteed") });
      }
    });
    return out;
  }, [banners]);
  const rows = useMemo(
    () => Math.max(0, ...banners.flatMap((b) => Object.keys(b.rolls).map((p) => parseInt(p, 10)))),
    [banners]
  );
  const total = 2 * rows; // half-rows that start a position
  const n = cols.length;
  const targets = useMemo(() => new Set(result.targets), [result]);
  const units = result.units || {};

  // The selected path's cells, per half-row: "|column-banner:result|…".
  const marks = useMemo(() => {
    const map = new Map();
    if (path?.cells) {
      path.cells.forEach((cells, k) => {
        const j = path.actions[k].banner_index;
        for (const c of cells) {
          const h = halfRow(c.pos);
          map.set(h, `${map.get(h) || "|"}${j}:${c.result}|`);
        }
      });
    }
    return map;
  }, [path]);
  const endH = path ? halfRow(path.final_position) : -1;

  const wrapRef = useRef(null);
  const headRef = useRef(null);
  const [win, setWin] = useState([0, Math.min(total, 120)]);
  // Which half-rows to draw: the visible ones plus a buffer, starting on an A
  // position and ending after a B position so row spans stay intact.
  const updateWindow = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const top = wrap.scrollTop - (headRef.current?.offsetHeight ?? 0);
    let start = Math.max(0, Math.floor(top / HALF_ROW) - BUFFER);
    start -= start % 2;
    let end = Math.ceil((top + wrap.clientHeight) / HALF_ROW) + BUFFER;
    end = Math.min(total, Math.max(start + 2, end + (end % 2)));
    setWin((w) => (w[0] === start && w[1] === end ? w : [start, end]));
  }, [total]);
  useLayoutEffect(updateWindow, [updateWindow]);
  useEffect(() => {
    // Scroll events already fire at most once per frame; setWin skips no-op
    // updates. (No requestAnimationFrame: it pauses in background tabs.)
    const wrap = wrapRef.current;
    wrap.addEventListener("scroll", updateWindow, { passive: true });
    window.addEventListener("resize", updateWindow);
    return () => {
      wrap.removeEventListener("scroll", updateWindow);
      window.removeEventListener("resize", updateWindow);
    };
  }, [updateWindow]);

  if (!total) return null;
  const start = Math.min(win[0], Math.max(0, total - 2));
  const end = Math.min(win[1], total);
  const body = [];
  if (start > 0) body.push(<tr key="top" className="filler"><td colSpan={2 * n + 2} style={{ height: start * HALF_ROW }} /></tr>);
  for (let h = start; h < end; h++) {
    body.push(
      <TrackRow
        key={h}
        h={h}
        banners={banners}
        cols={cols}
        units={units}
        targets={targets}
        marks={marks.get(h) || ""}
        isNext={h === endH}
        spacerB={h === start ? n + 1 : 0}
      />
    );
  }
  // One half-row closes track A under the last drawn B position.
  body.push(<tr key="close"><td className="spacer" colSpan={n + 1} /></tr>);
  if (end < total) body.push(<tr key="bottom" className="filler"><td colSpan={2 * n + 2} style={{ height: (total - end) * HALF_ROW }} /></tr>);
  const tableWidth = 2 * (POS_WIDTH + cols.reduce((sum, c) => sum + c.width, 0));

  return (
    <div className="track-panel">
      <div className="track-head">
        <h4>Track table</h4>
        <span className="legend small">
          <span className="lg target" title="Your wishlist units, or every unit you don't own if the wishlist is empty">target</span>
          <span className="lg on-path">selected path</span>
          <span className="lg next">next pull after the path</span>
        </span>
      </div>
      <p className="muted small">
        Each banner's roll table (the same as godfat's), track A and track B. A <b>dupe</b> line is what that cell gives instead when
        your previous cat was the same, and where you jump. The <b>11-draw</b> column of a guaranteed banner is the
        uber an 11-draw starting on that row guarantees, and where you land after it (its dupe line: when the draw's first
        pull is a dupe).
      </p>
      <div className="track-wrap" ref={wrapRef}>
        <table className="track" style={{ width: tableWidth, "--half-row": `${HALF_ROW}px` }}>
          <colgroup>
            {[0, 1].map((side) => (
              <React.Fragment key={side}>
                <col style={{ width: POS_WIDTH }} />
                {cols.map((c, k) => <col key={k} style={{ width: c.width }} />)}
              </React.Fragment>
            ))}
          </colgroup>
          <thead ref={headRef}>
            <tr>
              {["A", "B"].map((side) => (
                <React.Fragment key={side}>
                  <th className="pos" title={`Track ${side}`}>{side}</th>
                  {cols.map((c, k) => (
                    <th key={k} title={c.kind === "guaranteed" ? `${banners[c.j].name} — 11-draw guaranteed uber` : banners[c.j].name}>
                      {c.j + 1}. {c.kind === "guaranteed" ? "11-draw" : banners[c.j].name}
                    </th>
                  ))}
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    </div>
  );
}

const TrackRow = memo(function TrackRow({ h, banners, cols, units, targets, marks, isNext, spacerB }) {
  const pos = posLabel(h);
  return (
    <tr>
      <th className={`pos ${isNext ? "next" : ""}`} rowSpan={2}>{pos}</th>
      {cols.map((c, k) => (
        <Cell key={k} pos={pos} col={c} banner={banners[c.j]} units={units} targets={targets} marks={marks} />
      ))}
      {spacerB > 0 && <td className="spacer" colSpan={spacerB} />}
    </tr>
  );
}, (a, b) =>
  a.h === b.h && a.banners === b.banners && a.cols === b.cols && a.targets === b.targets &&
  a.marks === b.marks && a.isNext === b.isNext && a.spacerB === b.spacerB);

function Cell({ pos, col, banner, units, targets, marks }) {
  const e = banner.rolls[pos];
  const g = col.kind === "guaranteed";
  const main = e && (g ? e.guaranteed_unit : e.unit);
  if (!main) return <td className="cell empty" rowSpan={2} />;
  const mainNext = g ? e.guaranteed_next : null;
  const alt = g ? e.alt_guaranteed_unit : e.alt_unit;
  const altNext = g ? e.alt_guaranteed_next : e.alt_next;
  // The path's result is shaded: the whole cell, or with a dupe line just the
  // part the path gets (the cat on top, or the dupe line).
  const mainOn = marks.includes(`|${col.j}:${g ? "guaranteed" : "unit"}|`);
  const altOn = marks.includes(`|${col.j}:${g ? "alt_guaranteed" : "alt"}|`);
  const cls = ["cell", RARITY_CLASS[units[main]?.rarity] || "", mainOn && !alt ? "on-path" : ""];
  const title = g
    ? `${pos} ${banner.name}: an 11-draw starting here guarantees ${main}` + (mainNext ? ` and you land on ${mainNext}` : "")
    : `${pos} ${banner.name}: ${main}` +
      (alt ? ` — if your previous cat was ${main}, you get ${alt} instead and jump to ${altNext}` : "");
  return (
    <td className={cls.filter(Boolean).join(" ")} rowSpan={2} title={title}>
      <div className={`main ${mainOn && alt ? "on-path" : ""}`}>
        <span className={`unit ${targets.has(main) ? "target" : ""}`}>{main}</span>
        {mainNext && <span className="jump"> → {mainNext}</span>}
      </div>
      {alt && (
        <div className={`dupe ${altOn ? "on-path" : ""}`}>
          <span className="dupe-tag">dupe</span>
          <span className={`unit ${targets.has(alt) ? "target" : ""}`}>{alt}</span>
          {altNext && <span className="jump">→ {altNext}</span>}
        </div>
      )}
    </td>
  );
}
