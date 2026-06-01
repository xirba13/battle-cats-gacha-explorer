import React from "react";

// Section 3: how to use the app.
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
          <b>You must already be seed-tracking.</b> This app does not find your
          seed — you provide it. You can get it at{" "}
          <a href="https://bc-seek.godfat.org/seek" target="_blank" rel="noreferrer">
            bc-seek.godfat.org/seek
          </a>. Only the <b>BCEN (English)</b> version is supported.
        </li>
        <li>
          <b>Nothing is stored on any server.</b> Your collection lives entirely
          in the page URL (see below), so bookmark it or save your code.
        </li>
      </ul>

      <h3>The top bar</h3>
      <ul>
        <li>Enter your current <b>seed</b> and your <b>resources</b> (rare tickets,
          cat food, platinum tickets, legend tickets).</li>
        <li>Everything updates the page URL automatically.</li>
      </ul>

      <h3>1 · Cat Guide</h3>
      <ul>
        <li>A grid mirroring the in-game Cat Guide order. <b>Click any tile</b> to
          toggle it owned / not-owned. Use the search box and filters to find units.</li>
        <li><b>Saving your collection:</b> it's encoded into the page URL. Use
          <b> Copy link</b> to save the whole thing, or <b>Copy code</b> to save just
          a short code. If you come back later and lost the link, click
          <b> Load a code…</b> and paste your code to restore everything.</li>
      </ul>

      <h3>2 · Path Finder</h3>
      <ol>
        <li><b>Fetch Upcoming banners</b> for your seed (godfat can be slow; results
          are cached).</li>
        <li><b>Pick the banners</b> to search. Platinum/Legend banners are
          pre-selected when you have the matching tickets.</li>
        <li><b>Find optimal paths.</b> Each path lists the exact pulls to reach the
          units you don't own yet, the resource cost, and ends at the last target.</li>
        <li>Pull that path in-game, then click <b>“I followed this path.”</b> Every
          unit pulled is marked owned, your resources are decremented, and your{" "}
          <b>new seed is filled in automatically</b> (read from godfat's data — just
          verify it). Then search again.</li>
      </ol>

      <h3>Pull cost model</h3>
      <ul>
        <li>A single pull costs <b>1 rare ticket</b>; once your tickets run out,
          single pulls cost <b>150 cat food</b> (tickets are spent first).</li>
        <li>An 11-roll (multi) costs <b>1500 cat food</b> (cat food only).</li>
        <li>Platinum / Legend Capsule pulls use <b>1 platinum / legend ticket</b> each.</li>
      </ul>

      <p className="muted small">
        Names and icons come from the Battle Cats Wiki (Miraheze) Cat Guide.
        Always confirm a path on{" "}
        <a href="https://bc.godfat.org/" target="_blank" rel="noreferrer">bc.godfat.org</a>{" "}
        before spending.
      </p>
    </div>
  );
}
