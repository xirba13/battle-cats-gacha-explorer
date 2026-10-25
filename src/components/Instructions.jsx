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
          <b>You must already be seed-tracking.</b> This app does not find your
          seed — you provide it. You can get it at{" "}
          <a href="https://bc-seek.godfat.org/seek" target="_blank" rel="noreferrer">
            bc-seek.godfat.org/seek
          </a>. Only the <b>BCEN (English)</b> version is supported.
        </li>
        <li>
          <b>Everything runs in your browser.</b> Nothing is stored on or sent to
          any server: your collection, wishlists, plan, seed and resources live in
          the page URL and in this browser (see below).
        </li>
      </ul>

      <h3>The top bar</h3>
      <ul>
        <li>Enter your current <b>seed</b> and your <b>resources</b> (rare tickets,
          cat food, platinum tickets, legend tickets).</li>
        <li><b>Last cat</b>: the cat you pulled just before this seed. If your next cat is the same
          Rare, the game rerolls it and you switch track, so the Path Finder needs it to get your first
          pull right. It's filled in when you follow a path; type a name if you pulled something
          elsewhere, or clear it (✕).</li>
        <li>Everything updates the page URL automatically.</li>
      </ul>

      <h3>1 · Cat Guide</h3>
      <ul>
        <li>A grid mirroring the in-game Cat Guide order. <b>Click any tile</b> to
          toggle it owned / not-owned. Use the search box and filters to find units.</li>
        <li><b>Saving your collection:</b> your collection, wishlists, plan, seed and resources
          are saved in this browser, so opening the site again brings them back. They're also in
          the page URL: use <b>Copy link</b> to save the whole thing, or <b>Copy code</b> to
          save just your collection as a short code, and <b>Load a code…</b> to restore it. That's
          how you move them to another device or browser (the browser's copy stays on that one).</li>
        <li>If you open a link whose data isn't what this browser saved (an old bookmark,
          someone else's link), the page asks which one to keep; nothing is saved over
          your copy until you choose.</li>
        <li>On a shared computer, untick <b>Save in this browser</b> (it forgets the saved
          copy). Private windows don't keep it, clearing your browser's site data deletes
          it, and Safari on iPhone forgets it after about a week without a visit unless
          the site is on your home screen — keep your link or code as a backup.</li>
      </ul>

      <h3>2 · Wishlist</h3>
      <ul>
        <li>The units you want, <b>most wanted first</b>. Click units under <b>Add units</b> to add
          them (by default it shows the units the Upcoming banners can give); drag a unit by
          <b> ⠿</b>, or use the arrows, to change its place. Owned units can go on it too (another
          copy, say).</li>
        <li><b>Several wishlists</b>: <b>＋ New list</b>, <b>Rename</b> and <b>Delete</b>. The one
          open is the one the Path Finder searches.</li>
        <li><b>Rank paths by</b>, chosen for each list: which paths come first when its units compete
          (two ubers on the same row of different banners, or one on track A and the other on track B):
          <ul>
            <li><b>Top of the list first</b>: a path with your #1 always beats one without it, even if
              the other gets more units; then #2 decides, and so on. Cost decides between paths that get
              the same units.</li>
            <li><b>Most units</b>: the path with the most of your units wins, whichever they are; between
              paths with as many, the cheaper one, and then the one with units higher on your list.</li>
          </ul></li>
        <li><b>Sharing a wishlist:</b> <b>Copy wishlist link</b> or <b>Copy wishlist code</b>. Whoever
          opens the link, or adds the code with <b>Add a shared wishlist…</b>, gets an exact copy of it
          (order, ranking and ticks) next to their own lists; nothing of theirs is replaced.</li>
      </ul>

      <h3>3 · Path Finder</h3>
      <ol>
        <li><b>Fetch Upcoming banners</b>: the banners running now and coming up, from godfat's open
          data (updated daily). The roll tables and paths are computed in your browser the same way
          godfat does, so neither his site nor any server has to be up.</li>
        <li><b>Search for</b> one of your wishlists, or <b>every unit you don't own</b>. Tick the
          wishlist units to search for (each one says whether the picked banners can give it), and
          pick how to rank the paths. With nothing ticked, it searches for every unit you don't
          own.</li>
        <li><b>Never skip a Legend Rare</b> (an option): Legend Rares come up on the same rows on every
          normal banner that has one. With this ticked, a path that gets to such a row pulls a Legend
          Rare there, even if it isn't a target: no Platinum Capsule pull there, no banner without a
          Legend Rare, and no guaranteed 11-draw whose uber would take its place (an 11-draw's uber
          replaces the 11th roll). The Legend Capsule's own Legend Rares don't count. It's a strict
          rule: a target that can only be reached by skipping one isn't offered. Legend Rare pulls
          are tagged ✨ in the steps.</li>
        <li><b>Depth</b> (how far down the roll tables go) is automatic: as deep as your
          resources can pull, about one row per pull, so the best paths can use them all.
          Type a number to change it; <b>Auto</b> switches back.</li>
        <li><b>Pick the banners</b> to search. Platinum/Legend banners are
          pre-selected when you have the matching tickets.</li>
        <li><b>Find optimal paths.</b> Each path's title shows the targets it reaches (wishlist
          units with their place: #1…) and its resource cost. The selected path (the best one at
          first) also lists its exact pulls, ending at the last target; <b>click another path's
          title</b> to see its pulls instead.</li>
        <li><b>💬 Explain the path</b> (a button on the selected path and on your plans) adds a short
          reason under each step: 🎯 the targets it gets, ✨ the Legend Rares it pulls, 🔀 where its
          track switches lead, ↪ the switch it sets up for the next step, or ⬇ where it moves you and
          toward which target (one line for a run of such steps). They say what each step does, all of
          it on the track table, so you can check it; the search picks the whole path at once, so they
          don't say why it chose that step over another. The button is remembered in this browser.</li>
        <li><b>Track switches</b>: when a pull gives the same Rare as the cat pulled just before it (on
          any banner, or your last cat before the seed), the game rerolls it and you jump, usually to
          the other track. Every path accounts for them, and shows them with 🔀: in its title (where
          they happen), under the step they happen in (which pull, what you get instead and where you
          land, inside 11-draws too) and on the track table. If your next pull after a path would be one,
          it says so.</li>
        <li>Under the paths, the <b>track table</b> shows each banner's roll table (track A and
          track B, with an 11-draw column on guaranteed banners). The selected path is shaded, the
          targets are in bold (with their wishlist place), its track switches are outlined (🔀, also
          where godfat's table shows no dupe line, after another banner's cat), and the striped
          position is where you'll be after the path.</li>
        <li><b>📌 Save as a plan</b> keeps a path in <b>your plans</b>, at the top of the Path Finder (up
          to 10, named “Plan 1”, “Plan 2”…; <b>Rename</b> them as you like), each with its pulls and table,
          until you follow or remove it: they're in the page URL and this browser, so they're there when
          you come back, without searching again. One is open at a time; click another's title to see it.
          A plan that starts from a seed you've pulled past (or changed) shows as <b>outdated</b>: kept to
          look back at, but it can't be followed; <b>Remove the outdated plans</b> clears them.
          <b> Copy link for my other devices</b> carries everything (collection, wishlists, all your plans,
          seed, resources) to another device of yours. <b>Share plan (read-only)</b> copies a link for a
          friend with just that plan: it opens it (with your collection and wishlists) read-only, saves
          nothing in their browser and leaves their own data alone. From there, <b>Add their wishlist to
          mine</b> copies the wishlist into their lists.</li>
        <li>Pull that path in-game, then click <b>“I followed this path.”</b> Every
          unit pulled is marked owned, your resources are decremented, your{" "}
          <b>new seed is filled in automatically</b> (worked out the same way godfat does — just
          verify it). If the path was one of your plans, it's taken off them; your other plans for that
          seed then show as outdated. If it pulled units on your wishlists, you're
          asked whether to take them off (keep them if you want more copies). Then search
          again.</li>
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
