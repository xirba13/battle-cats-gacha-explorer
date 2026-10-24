import React, { useEffect, useRef, useState } from "react";

// A button that copies `text()` to the clipboard. Where the browser won't
// allow that, the text shows in a box, selected, to copy by hand.
export default function CopyButton({ text, label, className, disabled, title }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    if (manual) box.current?.select();
  }, [manual]);

  const copy = async () => {
    const value = text();
    try {
      await navigator.clipboard.writeText(value);
      setManual(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setManual(value);
    }
  };

  return (
    <>
      <button className={className} onClick={copy} disabled={disabled} title={title}>
        {copied ? "✓ Copied!" : label}
      </button>
      {manual && (
        <span className="manual-copy">
          <span className="muted small">This browser didn't let the page copy it: copy it from here.</span>
          <input ref={box} readOnly value={manual} onFocus={(e) => e.target.select()} />
          <button className="small" onClick={() => setManual(null)}>Close</button>
        </span>
      )}
    </>
  );
}
