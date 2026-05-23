import React, { useEffect, useRef, useState } from "react";
import { searchSymbols } from "../lib/api";

/**
 * Unified symbol picker that searches ALL sources at once. Type anything (a coin,
 * a stock, an index) and results come back from every source, each tagged with the
 * source it belongs to. Picking a result sets both the source and the symbol.
 */
export default function SymbolSearch({ value, source, onPick }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Debounced search across all sources whenever the query changes while open.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchSymbols(query);
        if (active) setResults(r);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [open, query]);

  const pick = (r) => {
    setOpen(false);
    setQuery("");
    if (r.source !== source || r.symbol !== value) onPick(r.source, r.symbol);
  };

  return (
    <div className="symbol-search" ref={boxRef}>
      <button
        className="symbol-btn"
        title="Search any symbol across all sources"
        onClick={() => {
          setQuery("");
          setOpen((o) => !o);
        }}
      >
        {value} <span className="caret">▾</span>
      </button>
      {open && (
        <div className="symbol-dropdown">
          <input
            autoFocus
            className="symbol-input"
            placeholder="Search any symbol (crypto, stocks, indices)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="symbol-results">
            {loading && <div className="symbol-empty">Searching…</div>}
            {!loading && results.length === 0 && (
              <div className="symbol-empty">No matches</div>
            )}
            {!loading &&
              results.map((r) => (
                <button
                  key={`${r.source}:${r.symbol}`}
                  className="symbol-result"
                  onClick={() => pick(r)}
                >
                  <span className="row">
                    <span className="sym">{r.symbol}</span>
                    <span className={`badge badge-${r.source}`}>{r.source}</span>
                  </span>
                  <span className="name">{r.name}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
