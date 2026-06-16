import React, { useEffect, useRef, useState } from "react";
import { useChart } from "../hooks/useChart";
import { useCandleStream } from "../hooks/useCandleStream";
import { useReplayData } from "../hooks/useReplayData";
import { useReplay } from "../replay/ReplayProvider";
import { useTrading } from "../trading/TradingProvider";
import { fetchCandles } from "../lib/api";
import { toKline, INTERVAL_SECONDS } from "../lib/kline";
import { registerHtfIndicator, HTF_INDICATOR, htfPanelWidth } from "../lib/htfIndicator";
import TickerBar from "./TickerBar";
import SymbolSearch from "./SymbolSearch";
import TradePanel from "./TradePanel";
import BacktestPanel from "./BacktestPanel";

registerHtfIndicator();

const MAIN_PANE = "candle_pane";
const MAIN_INDICATORS = ["MA", "EMA", "BOLL"]; // overlaid on the price pane
const SUB_INDICATORS = ["VOL", "MACD", "RSI", "KDJ"]; // each in its own sub-pane
const ALL_INDICATORS = [...MAIN_INDICATORS, ...SUB_INDICATORS];

const HTF_OPTIONS = ["1h", "4h", "1d"]; // higher timeframes that can be stacked
const HTF_COUNT = 6; // candles shown per HTF group
const DEFAULT_RIGHT_OFFSET = 80;

const toHtf = (c) => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close });

const DRAW_TOOLS = [
  { id: "segment", label: "Trend line" },
  { id: "horizontalStraightLine", label: "Horizontal line" },
  { id: "rayLine", label: "Ray line" },
  { id: "priceLine", label: "Price line" },
  { id: "fibonacciLine", label: "Fibonacci" },
  { id: "rect", label: "Rectangle" },
];

export default function ChartPane({ paneId, config, sources, onConfigChange }) {
  const { hostRef, chartRef, ready } = useChart();
  const { mode } = useReplay();
  const { reportPrice, trades } = useTrading();
  const [price, setPrice] = useState(null);
  const [lastTime, setLastTime] = useState(null); // time (sec) of the latest candle
  const [error, setError] = useState(null);
  const [menu, setMenu] = useState(null); // "draw" | "ind" | "trade" | "backtest" | null
  const [btResult, setBtResult] = useState(null);
  const menuRef = useRef(null);
  const overlayIdsRef = useRef([]);
  const markerIdsRef = useRef(new Map()); // tradeId -> overlay id
  const btMarkerIdsRef = useRef([]); // backtest entry-marker overlay ids

  const isReplay = mode === "replay";
  const indicators = (config.indicators ?? []).filter((x) => typeof x === "string");
  const indKey = indicators.join(",");
  const htfs = (config.htfs ?? []).filter((x) => HTF_OPTIONS.includes(x));
  const htfKey = htfs.join(",");

  // Update the ticker and mark the trading account at the pane's current price.
  const mark = (close, time) => {
    setPrice(close);
    setLastTime(time);
    if (close != null) reportPrice(config.symbol, close, time);
  };

  // In live mode, flag data that's gone stale (e.g. a closed/holiday market) so a
  // frozen chart reads as "market closed" rather than broken.
  const stale =
    !isReplay &&
    lastTime != null &&
    Date.now() / 1000 - lastTime > 3 * (INTERVAL_SECONDS[config.interval] || 60);

  // Live feed (active in live mode).
  useCandleStream({
    paneId,
    source: config.source,
    symbol: config.symbol,
    interval: config.interval,
    enabled: !isReplay,
    onHistory: (cands) => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.applyNewData(cands.map(toKline), true); // more=true -> allow loading older
      const last = cands[cands.length - 1];
      if (last) mark(last.close, last.time);
    },
    onUpdate: (c) => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.updateData(toKline(c));
      mark(c.close, c.time);
    },
    onError: setError,
  });

  // Replay feed (active in replay mode) — driven by the global clock.
  useReplayData({
    paneId,
    source: config.source,
    symbol: config.symbol,
    interval: config.interval,
    enabled: isReplay,
    chartRef,
    ready,
    onPrice: mark,
  });

  // Endless history (live mode): when the user scrolls back to the oldest bar,
  // fetch a batch of older candles until the data source runs out.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready || isReplay) return;
    chart.setLoadDataCallback(async ({ type, data, callback }) => {
      if (type !== "forward" || !data) {
        callback([], true);
        return;
      }
      try {
        const end = Math.floor(data.timestamp / 1000) - 1;
        const older = await fetchCandles(config.source, config.symbol, config.interval, 500, end);
        const klines = older.filter((c) => c.time * 1000 < data.timestamp).map(toKline);
        callback(klines, klines.length > 0);
      } catch {
        callback([], false);
      }
    });
    return () => {
      try { chart.setLoadDataCallback(() => {}); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isReplay, config.source, config.symbol, config.interval]);

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

  // ---- ICT HTF candles: fetch the chosen higher timeframes and paint them in the
  // right margin via the custom indicator. Reserves right-offset space for the panel.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready || !htfs.length) return;
    let cancelled = false;
    chart.createIndicator({ name: HTF_INDICATOR, extendData: { groups: [] } }, true, { id: MAIN_PANE });

    const refresh = async () => {
      const groups = [];
      for (const htf of htfs) {
        try {
          const cs = await fetchCandles(config.source, config.symbol, htf, HTF_COUNT);
          groups.push({ htf, candles: cs.map(toHtf) });
        } catch {
          groups.push({ htf, candles: [] });
        }
      }
      if (cancelled || !chartRef.current) return;
      chartRef.current.setOffsetRightDistance(htfPanelWidth(groups.length, HTF_COUNT));
      chartRef.current.overrideIndicator({ name: HTF_INDICATOR, extendData: { groups } }, MAIN_PANE);
    };

    refresh();
    const timer = setInterval(refresh, 20000); // keep HTF candles roughly current

    return () => {
      cancelled = true;
      clearInterval(timer);
      try { chart.removeIndicator(MAIN_PANE, HTF_INDICATOR); } catch {}
      try { chart.setOffsetRightDistance(DEFAULT_RIGHT_OFFSET); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, config.source, config.symbol, htfKey]);

  const toggleHtf = (htf) => {
    const next = htfs.includes(htf) ? htfs.filter((h) => h !== htf) : [...htfs, htf];
    onConfigChange({ ...config, htfs: next });
  };

  // ---- Trade markers: draw a marker for each of this symbol's trades ----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    for (const tr of trades) {
      if (tr.symbol !== config.symbol || tr.time == null || markerIdsRef.current.has(tr.id)) continue;
      try {
        const id = chart.createOverlay({
          name: "simpleAnnotation",
          points: [{ timestamp: tr.time * 1000, value: tr.price }],
          extendData: tr.side === "buy" ? "B" : "S",
          lock: true,
        });
        if (id) markerIdsRef.current.set(tr.id, id);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, config.symbol, ready]);

  // Trade markers are anchored to this symbol; clear them when it changes.
  useEffect(() => {
    return () => {
      const chart = chartRef.current;
      if (!chart) return;
      for (const id of markerIdsRef.current.values()) {
        try { chart.removeOverlay(id); } catch {}
      }
      markerIdsRef.current.clear();
    };
  }, [config.symbol, isReplay]);

  // Backtest entry markers (redrawn whenever a run completes; capped for clarity).
  useEffect(() => {
    const chart = chartRef.current;
    if (chart) {
      for (const id of btMarkerIdsRef.current) {
        try { chart.removeOverlay(id); } catch {}
      }
      btMarkerIdsRef.current = [];
    }
    if (!chart || !ready || !btResult) return;
    for (const tr of btResult.trades.slice(0, 150)) {
      try {
        const id = chart.createOverlay({
          name: "simpleAnnotation",
          points: [{ timestamp: tr.entryTime * 1000, value: tr.entryPrice }],
          extendData: tr.side > 0 ? "▲" : "▼",
          lock: true,
        });
        if (id) btMarkerIdsRef.current.push(id);
      } catch {}
    }
  }, [btResult, ready]);

  // Drop backtest results when the instrument changes.
  useEffect(() => {
    setBtResult(null);
  }, [config.symbol, config.interval]);

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
                <div className="menu-sep">HTF candles</div>
                {HTF_OPTIONS.map((htf) => (
                  <label key={htf} className="menu-item check">
                    <input
                      type="checkbox"
                      checked={htfs.includes(htf)}
                      onChange={() => toggleHtf(htf)}
                    />
                    {htf.toUpperCase()} candles
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="menu-wrap">
            <button
              className="tool"
              title="Paper trade"
              onClick={() => setMenu((m) => (m === "trade" ? null : "trade"))}
            >
              $
            </button>
            {menu === "trade" && (
              <div className="tool-menu">
                <TradePanel symbol={config.symbol} />
              </div>
            )}
          </div>
          <div className="menu-wrap">
            <button
              className={`tool${btResult ? " active" : ""}`}
              title="Strategy backtest"
              onClick={() => setMenu((m) => (m === "backtest" ? null : "backtest"))}
            >
              Σ
            </button>
            {menu === "backtest" && (
              <div className="tool-menu">
                <BacktestPanel
                  source={config.source}
                  symbol={config.symbol}
                  interval={config.interval}
                  onResult={setBtResult}
                />
              </div>
            )}
          </div>
        </div>

        {stale && (
          <span className="stale-badge" title="No recent data — market may be closed">
            closed
          </span>
        )}
        <TickerBar price={price} />
      </div>
      <div className="chart-host" ref={hostRef}>
        {error && <div className="pane-error">{error}</div>}
      </div>
    </div>
  );
}
