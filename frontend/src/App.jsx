import React, { useEffect, useState } from "react";
import { fetchSources } from "./lib/api";
import { StreamProvider } from "./ws/StreamProvider";
import ChartGrid from "./components/ChartGrid";

const COUNT_OPTIONS = [1, 2, 4, 6, 8];
const COUNT_KEY = "tm:chartCount";
const PANES_KEY = "tm:panes";

function loadCount() {
  const v = parseInt(localStorage.getItem(COUNT_KEY) ?? "4", 10);
  return COUNT_OPTIONS.includes(v) ? v : 4;
}

function loadPanes() {
  try {
    return JSON.parse(localStorage.getItem(PANES_KEY)) ?? [];
  } catch {
    return [];
  }
}

function defaultPane(sources) {
  const s = sources[0];
  const interval = s.intervals.includes("1m") ? "1m" : s.intervals[0];
  return { source: s.name, symbol: s.symbols[0], interval, indicators: [] };
}

export default function App() {
  const [sources, setSources] = useState(null);
  const [count, setCount] = useState(loadCount);
  const [panes, setPanes] = useState(loadPanes);

  useEffect(() => {
    fetchSources().then(setSources).catch((e) => setSources({ error: e.message }));
  }, []);

  // Ensure we always have a config for every visible pane (fill new ones with defaults).
  useEffect(() => {
    if (!Array.isArray(sources) || !sources.length) return;
    setPanes((prev) => {
      const next = [...prev];
      for (let i = 0; i < 8; i++) {
        if (!next[i]) next[i] = defaultPane(sources);
      }
      return next;
    });
  }, [sources]);

  useEffect(() => {
    localStorage.setItem(COUNT_KEY, String(count));
  }, [count]);

  useEffect(() => {
    if (panes.length) localStorage.setItem(PANES_KEY, JSON.stringify(panes));
  }, [panes]);

  const onPaneChange = (i, next) => {
    setPanes((prev) => {
      const copy = [...prev];
      copy[i] = next;
      return copy;
    });
  };

  if (sources === null) {
    return <div className="app"><div className="toolbar"><h1>TradeMatrix</h1></div><p style={{ padding: 16 }}>Loading…</p></div>;
  }
  if (sources.error) {
    return <div className="app"><div className="toolbar"><h1>TradeMatrix</h1></div><p style={{ padding: 16, color: "#ef5350" }}>Backend unreachable: {sources.error}</p></div>;
  }
  if (panes.length < count) {
    return <div className="app"><div className="toolbar"><h1>TradeMatrix</h1></div></div>;
  }

  return (
    <StreamProvider>
      <div className="app">
        <div className="toolbar">
          <h1>TradeMatrix</h1>
          <span className="spacer" />
          <label>Number of charts</label>
          <div className="count-group">
            {COUNT_OPTIONS.map((n) => (
              <button
                key={n}
                className={n === count ? "active" : ""}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <ChartGrid count={count} panes={panes} sources={sources} onPaneChange={onPaneChange} />
      </div>
    </StreamProvider>
  );
}
