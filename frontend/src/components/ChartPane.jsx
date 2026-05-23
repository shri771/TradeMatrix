import React, { useEffect, useRef, useState } from "react";
import { useChart } from "../hooks/useChart";
import { useCandleStream } from "../hooks/useCandleStream";
import TickerBar from "./TickerBar";
import SymbolSearch from "./SymbolSearch";

const MAIN_PANE = "candle_pane";
const MAIN_INDICATORS = ["MA", "EMA", "BOLL"]; // overlaid on the price pane
const SUB_INDICATORS = ["VOL", "MACD", "RSI", "KDJ"]; // each in its own sub-pane
const ALL_INDICATORS = [...MAIN_INDICATORS, ...SUB_INDICATORS];

const DRAW_TOOLS = [
  { id: "segment", label: "Trend line" },
  { id: "horizontalStraightLine", label: "Horizontal line" },
  { id: "rayLine", label: "Ray line" },
  { id: "priceLine", label: "Price line" },
  { id: "fibonacciLine", label: "Fibonacci" },
  { id: "rect", label: "Rectangle" },
];

const toKline = (c) => ({
  timestamp: c.time * 1000,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
  volume: c.volume,
});

export default function ChartPane({ paneId, config, sources, onConfigChange }) {
  const { hostRef, chartRef, ready } = useChart();
  const [price, setPrice] = useState(null);
  const [error, setError] = useState(null);
  const [menu, setMenu] = useState(null); // "draw" | "ind" | null
  const menuRef = useRef(null);
  const overlayIdsRef = useRef([]);

  const indicators = (config.indicators ?? []).filter((x) => typeof x === "string");
  const indKey = indicators.join(",");

  useCandleStream({
    paneId,
    source: config.source,
    symbol: config.symbol,
    interval: config.interval,
    onHistory: (cands) => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.applyNewData(cands.map(toKline));
      setPrice(cands.length ? cands[cands.length - 1].close : null);
    },
    onUpdate: (c) => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.updateData(toKline(c));
      setPrice(c.close);
    },
    onError: setError,
  });

  const sourceDef = sources.find((s) => s.name === config.source) ?? sources[0];

  const update = (patch) => {
    const next = { ...config, ...patch };
    if (patch.source) {
      const def = sources.find((s) => s.name === patch.source);
      if (def) {
        if (patch.symbol === undefined && !def.symbols.includes(next.symbol)) {
          next.symbol = def.symbols[0];
        }
        if (!def.intervals.includes(next.interval)) next.interval = def.intervals[0];
      }
    }
    onConfigChange(next);
  };

  // ---- Indicators: sync chart indicators with the persisted name list ----
  const appliedRef = useRef(new Set());
  const builtForRef = useRef(null);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    if (builtForRef.current !== chart) {
      appliedRef.current = new Set(); // chart was (re)created; re-apply from scratch
      builtForRef.current = chart;
    }
    const applied = appliedRef.current;
    const desired = new Set(indicators);

    for (const name of [...applied]) {
      if (!desired.has(name)) {
        chart.removeIndicator(MAIN_INDICATORS.includes(name) ? MAIN_PANE : name, name);
        applied.delete(name);
      }
    }
    for (const name of desired) {
      if (!applied.has(name)) {
        if (MAIN_INDICATORS.includes(name)) chart.createIndicator(name, true, { id: MAIN_PANE });
        else chart.createIndicator(name, false, { id: name });
        applied.add(name);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, indKey]);

  // ---- Drawing overlays ----
  const clearDrawings = () => {
    chartRef.current?.removeOverlay();
    overlayIdsRef.current = [];
  };

  const startDraw = (overlayName) => {
    const chart = chartRef.current;
    if (!chart) return;
    const id = chart.createOverlay(overlayName);
    if (id) overlayIdsRef.current.push(id);
    setMenu(null);
  };

  // Overlays are anchored to specific times/prices; reset on instrument change.
  useEffect(() => {
    clearDrawings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.source, config.symbol, config.interval]);

  const toggleIndicator = (name) => {
    const next = indicators.includes(name)
      ? indicators.filter((n) => n !== name)
      : [...indicators, name];
    onConfigChange({ ...config, indicators: next });
  };

  // Close menus on outside click.
  useEffect(() => {
    if (!menu) return;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  return (
    <div className="pane">
      <div className="pane-header">
        <select value={config.source} onChange={(e) => update({ source: e.target.value })}>
          {sources.map((s) => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>
        <SymbolSearch
          source={config.source}
          value={config.symbol}
          onPick={(src, sym) => update({ source: src, symbol: sym })}
        />
        <select value={config.interval} onChange={(e) => update({ interval: e.target.value })}>
          {sourceDef.intervals.map((iv) => (
            <option key={iv} value={iv}>{iv}</option>
          ))}
        </select>

        <div className="tools" ref={menuRef}>
          <div className="menu-wrap">
            <button
              className="tool"
              title="Drawing tools"
              onClick={() => setMenu((m) => (m === "draw" ? null : "draw"))}
            >
              ✎
            </button>
            {menu === "draw" && (
              <div className="tool-menu">
                {DRAW_TOOLS.map((t) => (
                  <button key={t.id} className="menu-item" onClick={() => startDraw(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="tool" title="Clear drawings" onClick={clearDrawings}>
            ✕
          </button>
          <div className="menu-wrap">
            <button
              className={`tool${indicators.length ? " active" : ""}`}
              title="Indicators"
              onClick={() => setMenu((m) => (m === "ind" ? null : "ind"))}
            >
              ƒ
            </button>
            {menu === "ind" && (
              <div className="tool-menu">
                {ALL_INDICATORS.map((name) => (
                  <label key={name} className="menu-item check">
                    <input
                      type="checkbox"
                      checked={indicators.includes(name)}
                      onChange={() => toggleIndicator(name)}
                    />
                    {name}
                    {SUB_INDICATORS.includes(name) ? " ·sub" : ""}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <TickerBar price={price} />
      </div>
      <div className="chart-host" ref={hostRef}>
        {error && <div className="pane-error">{error}</div>}
      </div>
    </div>
  );
}
