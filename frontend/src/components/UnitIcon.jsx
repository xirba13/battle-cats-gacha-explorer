import React, { useState } from "react";

// Renders a unit icon from the locally-downloaded set (/icons/<file>) and falls
// back to the wiki CDN url if the local file is missing. `unit`/`cell` objects
// carry `icon` (filename) and/or `icon_url` (remote).
export default function UnitIcon({ unit, className }) {
  const local = unit.icon ? `/icons/${unit.icon}` : null;
  const remote = unit.icon_url || null;
  const [src, setSrc] = useState(local || remote);

  if (!src) return <span className="no-icon">?</span>;

  return (
    <img
      className={className}
      src={src}
      alt={unit.name || ""}
      loading="lazy"
      onError={() => {
        // Local missing -> try the remote url once; then give up.
        if (remote && src !== remote) setSrc(remote);
      }}
    />
  );
}
