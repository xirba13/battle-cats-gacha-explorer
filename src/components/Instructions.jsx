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
          <b>Everything runs in your browser.</b> Nothing is stored on or sent to
          any server: your collection, seed and resources live in the page URL and
          in this browser (see below).
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
        <li><b>Saving your collection:</b> your collection, seed and resources are saved
          in this browser, so opening the site again brings them back. They're also in
          the page URL: use <b>Copy link</b> to save the whole thing, or <b>Copy code</b> to
          save just a short code, and <b>Load a code…</b> to restore it. That's how you move
          them to another device or browser (the browser's copy stays on that one).</li>
        <li>If you open a link whose data isn't what this browser saved (an old bookmark,
          someone else's link), the page asks which one to keep; nothing is saved over
          your copy until you choose.</li>
        <li>On a shared computer, untick <b>Save in this browser</b> (it forgets the saved
          copy). Private windows don't keep it, clearing your browser's site data deletes
          it, and Safari on iPhone forgets it after about a week without a visit unless
          the site is on your home screen — keep your link or code as a backup.</li>
      </ul>

      <h3>2 · Path Finder</h3>
      <ol>
        <li><b>Fetch Upcoming banners</b>: the banners running now and coming up, from godfat's open
          data (updated daily). The roll tables and paths are computed in your browser the same way
          godfat does, so neither his site nor any server has to be up.</li>
        <li><b>Targets:</b> every unit you don't own in the picked banners, or, if you fill in the
          <b> wishlist</b>, only the units on it, even ones you own (another copy, say).</li>
        <li><b>Pick the banners</b> to search. Platinum/Legend banners are
          pre-selected when you have the matching tickets.</li>
        <li><b>Find optimal paths.</b> Each path's title shows the units you don't own yet
          that it reaches and its resource cost. The selected path (the best one at first) also
          lists its exact pulls, ending at the last target; <b>click another path's title</b> to
          see its pulls instead.</li>
        <li>Under the paths, the <b>track table</b> shows each banner's roll table (track A and
          track B, with an 11-draw column on guaranteed banners). The selected path is shaded, the
          targets are in bold, and the striped position is where you'll be after the path.</li>
        <li>Pull that path in-game, then click <b>“I followed this path.”</b> Every
          unit pulled is marked owned, your resources are decremented, and your{" "}
          <b>new seed is filled in automatically</b> (worked out the same way godfat does — just
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
