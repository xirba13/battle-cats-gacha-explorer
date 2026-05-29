import React from "react";

// Section 4: how to use the app.
export default function Instructions({ disclaimer }) {
  return (
    <div className="instructions">
      <h2>How to use Battle Cats Gacha Explorer</h2>

      <p className="notice">
        ℹ️ {disclaimer ||
          "This tool is experimental and not fully tested. Always check a " +
            "path on bc.godfat.org before spending real resources."}
      </p>

      <h3>Before you start</h3>
      <ul>
        <li>
          <b>You must already be seed-tracking.</b> This app does not
          find your seed, you need to provide it. you can get it in bc-seek.godfat.org/seek. Re-write your seed after every pull session.
        </li>
        <li>
          When screenshotting the Cat Guide, use the <b>default view with NO filter
          applied</b>, or the slot order won&apos;t match and detection will be wrong.
        </li>
      </ul>

      <h3>The top bar</h3>
      <ul>
        <li>Set your <b>region</b> (only BCEN avaliable), your current <b>seed</b>, and your <b>resources</b>
          {" "}(rare tickets, cat food, platinum tickets, legend tickets).</li>
        <li>These are saved automatically and used by the path finder.</li>
      </ul>

      <h3>1 · Screenshot Import (optional)</h3>
      <ul>
        <li>Upload Cat Guide screenshots <b>page by page</b> (set the page number).</li>
        <li>The app classifies each tile as <b>unlocked</b> (owned) or <b>locked</b>{" "}
          (the gray “?” box) — it does not read which cat it is; the slot position does.</li>
        <li><b>Detection is not perfect.</b> Review the results, then apply them and
          fix any mistake with one click in the Cat Guide. You can skip screenshots
          entirely and just mark units by hand.</li>
      </ul>

      <h3>2 · Cat Guide</h3>
      <ul>
        <li>A grid mirroring the in-game Cat Guide order. <b>Click any tile</b> to
          toggle it owned / not-owned.</li>
        <li>Use the <b>search box</b> and the owned/rarity filters to find units fast.</li>
        <li>This owned-state is what the path finder treats as &quot;already have&quot;.</li>
      </ul>

      <h3>3 · Path Finder</h3>
      <ol>
        <li><b>Fetch Upcoming banners</b> for your seed (godfat pages can be slow;
          results are cached per seed).</li>
        <li><b>Pick the banners</b> to search. Platinum/Legend banners are
          pre-selected when you have the matching tickets.</li>
        <li><b>Find optimal paths.</b> Each path lists the exact pulls to reach the
          not-yet-owned units, the resource cost, and ends at the last target.</li>
        <li>Pull that path in-game, then click <b>“I followed this path.”</b> Every
          unit pulled along it is marked owned, your resources are decremented, the
          other paths are discarded, and you&apos;re asked to enter your <b>new seed</b>.</li>
      </ol>

      <h3>Pull cost model</h3>
      <ul>
        <li>A single pull costs <b>1 rare ticket</b>; once your tickets run out,
          single pulls cost <b>150 cat food</b>.</li>
        <li>An 11-roll (multi) costs <b>1500 cat food</b> (cat food only).</li>
        <li>Platinum / Legend Capsule pulls use <b>1 platinum / legend ticket</b> each.</li>
      </ul>

      <p className="muted small">
        Names and icons come from the Battle Cats wiki (Miraheze) Cat Guide (BCEN by default).
        Always confirm a path on <a href="https://bc.godfat.org/" target="_blank"
          rel="noreferrer">godfat.org</a> before spending.
      </p>
    </div>
  );
}
