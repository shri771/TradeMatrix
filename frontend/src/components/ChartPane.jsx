import React, { useEffect, useRef, useState } from "react";
import { useChart } from "../hooks/useChart";
import { useCandleStream } from "../hooks/useCandleStream";
import { useReplayData } from "../hooks/useReplayData";
import { useReplay } from "../replay/ReplayProvider";
import { useTrading } from "../trading/TradingProvider";
import { fetchCandles } from "../lib/api";
import { toKline, INTERVAL_SECONDS } from "../lib/kline";
import { registerHtfIndicator, HTF_INDICATOR, htfPanelWidth } from "../lib/htfIndicator";
import { registerFvgIndicator, FVG_INDICATOR } from "../lib/fvgIndicator";
import { registerPositionOverlays } from "../lib/positionOverlay";
import { registerFibonacciOverlay } from "../lib/fibonacciOverlay";
import { registerTrendLineOverlay } from "../lib/trendLineOverlay";
import { registerSmtOverlay } from "../lib/smtOverlay";
import { detectDivergences } from "../lib/smtDetect";
import TickerBar from "./TickerBar";
import SymbolSearch from "./SymbolSearch";
import TradePanel from "./TradePanel";
import BacktestPanel from "./BacktestPanel";

registerHtfIndicator();
registerFvgIndicator();
registerPositionOverlays();
registerFibonacciOverlay();
registerTrendLineOverlay();
registerSmtOverlay();

const MAIN_PANE = "candle_pane";
const MAIN_INDICATORS = ["MA", "EMA", "BOLL"]; // overlaid on the price pane
const SUB_INDICATORS = ["VOL", "MACD", "RSI", "KDJ"]; // each in its own sub-pane
const ALL_INDICATORS = [...MAIN_INDICATORS, ...SUB_INDICATORS];

const HTF_OPTIONS = ["30m", "1h", "4h", "1d"]; // higher timeframes that can be stacked
const HTF_COUNT = 6; // candles shown per HTF group
const DEFAULT_RIGHT_OFFSET = 80;

// ICT "Smart Money Technique" — highly-correlated US index futures.
// When the pane's symbol is one of these AND `smt` is enabled, we fetch the OTHER
// two symbols' HTF candles alongside the main and highlight direction divergences.
const SMT_TRIO = ["NQ.c.0", "ES.c.0", "YM.c.0"];
const SMT_LABEL = { "NQ.c.0": "NQ", "ES.c.0": "ES", "YM.c.0": "YM" };
// Correlate window fetched for replay SMT — matches REPLAY_BARS in useReplayData
// so the correlate history spans the same window the main pane replays.
const SMT_REPLAY_BARS = 1500;

const toHtf = (c) => ({ t: c.time, o: c.open, h: c.high, l: c.low, c: c.close });

const DRAW_TOOLS = [
  // NOTE: the custom `trendLine` (a bounded segment locked level to the first
  // click's price — see lib/trendLineOverlay.js) is a direct-action toolbar
  // button next to the Σ backtest button, not a dropdown entry.
  { id: "horizontalStraightLine", label: "Horizontal line" },
  { id: "rayLine", label: "Ray line" },
  { id: "priceLine", label: "Price line" },
  { id: "rect", label: "Rectangle" },
];

// Direct-action toolbar buttons for the R:R-aware trader tools. Each is a
// single-click entry into the corresponding overlay (no submenu) — up-triangle
// for LONG (green), down-triangle for SHORT (red), phi glyph for Fibonacci.
const POSITION_TOOLS = [
  { id: "longPosition",  label: "Long position",  glyph: "▲", cls: "long"  },
  { id: "shortPosition", label: "Short position", glyph: "▼", cls: "short" },
  { id: "fibonacciLine", label: "Fibonacci",      glyph: "φ", cls: "fib"   },
];

// Overlay-name → human label, used to name each entry in the per-drawing delete
// list. Covers every user-drawable tool (draw menu + position/fibonacci buttons +
// the standalone Trend line button, which isn't in DRAW_TOOLS).
const OVERLAY_LABELS = {
  ...Object.fromEntries([...DRAW_TOOLS, ...POSITION_TOOLS].map((t) => [t.id, t.label])),
  trendLine: "Trend line",
};

export default function ChartPane({ paneId, config, sources, onConfigChange }) {
  const { hostRef, chartRef, ready, resetView } = useChart(config.interval);
  const { mode, clock, endTs } = useReplay();
  const { reportPrice, trades } = useTrading();
  const [price, setPrice] = useState(null);
  const [lastTime, setLastTime] = useState(null); // time (sec) of the latest candle
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState(null); // "draw" | "drawings" | "ind" | "trade" | "backtest" | null
  const [btResult, setBtResult] = useState(null);
  // Bumped whenever a drawing is added/finished/removed so the per-drawing delete
  // list re-renders (drawings live in overlayIdsRef, which doesn't trigger renders).
  const [, setDrawVersion] = useState(0);
  const menuRef = useRef(null);
  const overlayIdsRef = useRef([]);
  const markerIdsRef = useRef(new Map()); // tradeId -> overlay id
  const btMarkerIdsRef = useRef([]); // backtest entry-marker overlay ids
  const smtOverlayIdsRef = useRef(new Set()); // SMT divergence overlay ids
  const smtSigRef = useRef(""); // signature of the last-drawn divergence set
  const smtCorrelateRef = useRef({ key: null, promise: null }); // cached correlate fetch

  const isReplay = mode === "replay";
  const indicators = (config.indicators ?? []).filter((x) => typeof x === "string");
  const indKey = indicators.join(",");
  const htfs = (config.htfs ?? []).filter((x) => HTF_OPTIONS.includes(x));
  const htfKey = htfs.join(",");
  const smtEnabled = !!config.smt && SMT_TRIO.includes(config.symbol);

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
    onLoading: setLoading,
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
    onLoading: setLoading,
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
    // Reserve the right-margin BEFORE the async fetch — otherwise the first
    // paint clips the panel off the right edge (the fetch below can take
    // seconds on cold Databento calls).
    try { chart.setOffsetRightDistance(htfPanelWidth(htfs.length, HTF_COUNT)); } catch {}
    // Remove any stale HTF indicator from a previous run before creating a new
    // one, otherwise a duplicate createIndicator call is silently dropped and
    // the panel doesn't render. Seed with skeleton groups (labels, no candles
    // yet) so every chosen timeframe's column shows immediately instead of a
    // single "HTF …" placeholder while data loads.
    try { chart.removeIndicator(MAIN_PANE, HTF_INDICATOR); } catch {}
    chart.createIndicator(
      { name: HTF_INDICATOR, extendData: { groups: htfs.map((htf) => ({ htf, candles: [] })) } },
      true,
      { id: MAIN_PANE }
    );

    const others = smtEnabled ? SMT_TRIO.filter((s) => s !== config.symbol) : [];

    const refresh = async () => {
      // Fetch every timeframe CONCURRENTLY and repaint as each arrives — so one
      // slow cold Databento fetch (a 4h/1d envelope miss can take 20s+) can't
      // block the others (or a freshly-added 30m) from showing. Was previously a
      // sequential loop that only painted after ALL fetches finished, so a single
      // slow interval left the whole panel stuck on "HTF …". Panel order and the
      // reserved right-margin width both follow `htfs`.
      const byHtf = new Map(htfs.map((htf) => [htf, { htf, candles: [] }]));
      const paint = () => {
        if (cancelled || !chartRef.current) return;
        const groups = htfs.map((htf) => byHtf.get(htf));
        chartRef.current.setOffsetRightDistance(htfPanelWidth(groups.length, HTF_COUNT));
        chartRef.current.overrideIndicator({ name: HTF_INDICATOR, extendData: { groups } }, MAIN_PANE);
      };
      await Promise.all(
        htfs.map(async (htf) => {
          try {
            const cs = await fetchCandles(config.source, config.symbol, htf, HTF_COUNT);
            const group = { htf, candles: cs.map(toHtf) };
            if (others.length) {
              // Pull the correlated symbols' HTF too and reduce to {label, dir} —
              // the indicator only needs the last-candle direction.
              const correlates = await Promise.all(
                others.map(async (sym) => {
                  try {
                    const oc = await fetchCandles(config.source, sym, htf, HTF_COUNT);
                    const last = oc[oc.length - 1];
                    if (!last) return null;
                    return {
                      symbol: sym,
                      label: SMT_LABEL[sym] ?? sym,
                      dir: last.close >= last.open ? "up" : "down",
                    };
                  } catch {
                    return null;
                  }
                })
              );
              group.correlates = correlates.filter(Boolean);
            }
            byHtf.set(htf, group);
          } catch {
            byHtf.set(htf, { htf, candles: [] });
          }
          paint(); // incremental: show each timeframe the moment its data lands
        })
      );
    };

    refresh();
    // 60s is comfortably fresh for HTF and cuts periodic load on slow backends
    // (Databento) by 3x vs the old 20s cadence.
    const timer = setInterval(refresh, 60000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      try { chart.removeIndicator(MAIN_PANE, HTF_INDICATOR); } catch {}
      try { chart.setOffsetRightDistance(DEFAULT_RIGHT_OFFSET); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, config.source, config.symbol, htfKey, smtEnabled]);

  // ---- ICT Fair Value Gaps: stacked indicator that shades 3-candle imbalances
  // on the price pane, extended a couple of candles forward. Toggled by config.fvg.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    if (!config.fvg) {
      try { chart.removeIndicator(MAIN_PANE, FVG_INDICATOR); } catch {}
      return;
    }
    try { chart.removeIndicator(MAIN_PANE, FVG_INDICATOR); } catch {}
    chart.createIndicator({ name: FVG_INDICATOR }, true, { id: MAIN_PANE });
    return () => {
      try { chart.removeIndicator(MAIN_PANE, FVG_INDICATOR); } catch {}
    };
  }, [ready, config.fvg]);

  // ---- SMT trend lines on the main chart ----
  // When SMT is enabled + we're on one of the trio, detect divergences between
  // this symbol and each correlate at the current interval, then draw a segment
  // overlay connecting the two divergent swing points on the main chart. Red =
  // bearish (main HH vs correlate LH), teal = bullish (main LL vs correlate HL).
  //
  // Works in BOTH live and replay. In replay the correlate window is fetched "as
  // of" the replay date (endTs, same window the main pane replays) and both
  // series are clipped to the global clock, so we only ever draw divergences the
  // trader could have seen at that replay moment — never future swings. Overlays
  // are locked (never draggable — computed, not user-drawn).
  const clearSmt = () => {
    const c = chartRef.current;
    for (const id of smtOverlayIdsRef.current) {
      try { c?.removeOverlay(id); } catch {}
    }
    smtOverlayIdsRef.current.clear();
  };

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready || !smtEnabled) return;
    let cancelled = false;
    const correlates = SMT_TRIO.filter((s) => s !== config.symbol);

    const detect = async () => {
      if (cancelled) return;
      const mainData = chart.getDataList?.() ?? [];
      if (!mainData.length) return;
      // KLineChart internal format uses `timestamp` (ms); our detector wants
      // `time` (seconds) alongside high/low, so normalise. In replay getDataList
      // is already clipped to the clock; clip again defensively.
      let mainCandles = mainData.map((c) => ({
        time: Math.floor(c.timestamp / 1000),
        high: c.high,
        low: c.low,
      }));
      if (isReplay && clock != null) mainCandles = mainCandles.filter((c) => c.time <= clock);
      if (!mainCandles.length) return;

      // Fetch the correlate windows. In replay, fetch "as of" the replay date and
      // cache the result (endTs is stable for the session), then clip per-clock
      // locally — so advancing the clock never triggers a network round-trip. In
      // live we refetch each pass so freshly-formed swings show up.
      const asOf = isReplay ? endTs : undefined;
      const key = `${isReplay ? "R" : "L"}|${config.source}|${config.symbol}|${config.interval}|${asOf ?? "latest"}`;
      if (!isReplay || smtCorrelateRef.current.key !== key) {
        const limit = isReplay ? SMT_REPLAY_BARS : Math.min(1000, mainData.length);
        smtCorrelateRef.current = {
          key,
          promise: Promise.all(
            correlates.map(async (sym) => {
              try {
                const cs = await fetchCandles(config.source, sym, config.interval, limit, asOf);
                return { symbol: sym, candles: cs };
              } catch { return null; }
            })
          ),
        };
      }
      const cors = (await smtCorrelateRef.current.promise).filter(Boolean);
      if (cancelled || !chartRef.current) return;

      // Detect divergences against each correlate, clipping the correlate to the
      // clock in replay so we don't peek at swings that form after "now".
      const divs = [];
      for (const cor of cors) {
        let corCandles = cor.candles;
        if (isReplay && clock != null) corCandles = corCandles.filter((c) => c.time <= clock);
        const label = SMT_LABEL[cor.symbol] ?? cor.symbol;
        for (const d of detectDivergences(mainCandles, corCandles)) divs.push({ label, ...d });
      }

      // Only touch the chart when the divergence set actually changes — replay
      // re-runs this every 200ms clock tick, and blindly clearing/recreating
      // overlays each tick would flicker and thrash klinecharts.
      const sig = divs.map((d) => `${d.label}|${d.direction}|${d.p1.time}|${d.p2.time}`).join("~");
      if (sig === smtSigRef.current) return;
      smtSigRef.current = sig;

      clearSmt();
      for (const d of divs) {
        try {
          const id = chartRef.current.createOverlay({
            name: "smtLine",
            points: [
              { timestamp: d.p1.time * 1000, value: d.p1.price },
              { timestamp: d.p2.time * 1000, value: d.p2.price },
            ],
            lock: true,
            extendData: { correlate: d.label, direction: d.direction },
          });
          if (typeof id === "string") smtOverlayIdsRef.current.add(id);
        } catch {}
      }
    };

    // Live: small delay so the initial applyNewData settles, then poll every 30s
    // so freshly-formed swings appear without a reload. Replay: the `clock` dep
    // re-runs this effect on each tick, so just detect immediately (no polling).
    let first;
    let timer;
    if (isReplay) {
      detect();
    } else {
      first = setTimeout(detect, 400);
      timer = setInterval(detect, 30_000);
    }

    return () => {
      cancelled = true;
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, smtEnabled, config.source, config.symbol, config.interval, isReplay, clock, endTs]);

  // Remove SMT overlays + reset caches when the instrument, SMT toggle, or replay
  // mode changes (NOT on every clock tick — the detector effect above handles
  // per-tick updates via signature diffing, keeping overlays alive across ticks).
  useEffect(() => {
    return () => {
      clearSmt();
      smtSigRef.current = "";
      smtCorrelateRef.current = { key: null, promise: null };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smtEnabled, config.source, config.symbol, config.interval, isReplay]);

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
    setDrawVersion((v) => v + 1);
    setMenu(null);
  };

  // Per-overlay delete: the position + fibonacci overlays render a small "×"
  // pill when selected. Clicking that pill dispatches a global
  // "tm:delete-overlay" event carrying the overlay id — we listen here, remove
  // the overlay from THIS pane's chart (silently no-ops if it lives on a
  // different pane's chart), and prune it from our tracking list.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    const onDelete = (e) => {
      const id = e.detail;
      try { chart.removeOverlay(id); } catch {}
      overlayIdsRef.current = overlayIdsRef.current.filter((x) => x !== id);
    };
    window.addEventListener("tm:delete-overlay", onDelete);
    return () => window.removeEventListener("tm:delete-overlay", onDelete);
  }, [ready]);

  const bumpDraw = () => setDrawVersion((v) => v + 1);

  const startDraw = (overlayName) => {
    const chart = chartRef.current;
    if (!chart) return;
    // Object form so we can hook per-instance lifecycle callbacks: onDrawEnd
    // refreshes the delete list once the drawing is finished, and onRemoved keeps
    // our tracking list + the delete menu in sync no matter HOW the overlay goes
    // away (toolbar delete, on-chart × pill, clear-all, or klinecharts itself).
    const id = chart.createOverlay({
      name: overlayName,
      onDrawEnd: () => { bumpDraw(); },
      onRemoved: () => {
        overlayIdsRef.current = overlayIdsRef.current.filter((x) => x !== id);
        bumpDraw();
      },
    });
    if (id) overlayIdsRef.current.push(id);
    bumpDraw();
    setMenu(null);
  };

  // Delete a single drawing by id. onRemoved (above) prunes the tracking list and
  // bumps, but we prune here too so the menu updates even if the callback is a
  // no-op for some overlay type.
  const deleteDrawing = (id) => {
    const chart = chartRef.current;
    try { chart?.removeOverlay(id); } catch {}
    overlayIdsRef.current = overlayIdsRef.current.filter((x) => x !== id);
    bumpDraw();
  };

  // Cancel any in-progress drawing (an armed but not-yet-finished overlay).
  // While a drawing is in progress, every click on the chart places the next
  // anchor instead of panning — so if the user forgets to finish, the chart
  // feels "stuck" (no pan). ESC (and clicking ✕ in the toolbar) drops the
  // pending overlay so click-drag pans again.
  const cancelPendingDraw = () => {
    const chart = chartRef.current;
    if (!chart) return false;
    for (const id of [...overlayIdsRef.current]) {
      const overlay = chart.getOverlayById?.(id);
      if (overlay?.isDrawing?.()) {
        try { chart.removeOverlay(id); } catch {}
        overlayIdsRef.current = overlayIdsRef.current.filter((x) => x !== id);
        return true;
      }
    }
    return false;
  };

  // Global ESC handler — cancels a pending drawing across every pane.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e) => {
      if (e.key === "Escape") cancelPendingDraw();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

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

  // Current drawings on this pane, in draw order, for the delete menu. Recomputed
  // each render (drawVersion drives re-renders); we read live overlay objects so
  // ids that no longer exist are skipped, and index each tool type for clarity
  // ("Trend line 1", "Trend line 2", …).
  const drawings = (() => {
    const chart = chartRef.current;
    if (!chart) return [];
    const counts = {};
    const out = [];
    for (const id of overlayIdsRef.current) {
      const ov = chart.getOverlayById?.(id);
      if (!ov) continue;
      counts[ov.name] = (counts[ov.name] ?? 0) + 1;
      out.push({ id, label: OVERLAY_LABELS[ov.name] ?? ov.name, n: counts[ov.name] });
    }
    return out;
  })();

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
          <div className="menu-wrap">
            <button
              className={`tool${drawings.length ? " active" : ""}`}
              title="Delete drawings"
              onClick={() => setMenu((m) => (m === "drawings" ? null : "drawings"))}
            >
              ✕
            </button>
            {menu === "drawings" && (
              <div className="tool-menu">
                {drawings.length === 0 ? (
                  <div className="menu-item menu-empty">No drawings yet</div>
                ) : (
                  <>
                    <div className="menu-sep">Drawings</div>
                    {drawings.map((d) => (
                      <div key={d.id} className="menu-item draw-row">
                        <span className="draw-label">{d.label} {d.n}</span>
                        <button
                          className="draw-del"
                          title={`Delete ${d.label} ${d.n}`}
                          onClick={() => deleteDrawing(d.id)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button className="menu-item draw-clear" onClick={clearDrawings}>
                      Clear all
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
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
                <label
                  className="menu-item check"
                  title={
                    SMT_TRIO.includes(config.symbol)
                      ? "Show correlated NQ/ES/YM direction badges; amber = SMT divergence"
                      : "SMT works on NQ.c.0 / ES.c.0 / YM.c.0 — pick one of those first"
                  }
                >
                  <input
                    type="checkbox"
                    checked={!!config.smt}
                    disabled={!SMT_TRIO.includes(config.symbol)}
                    onChange={() => onConfigChange({ ...config, smt: !config.smt })}
                  />
                  SMT (NQ/ES/YM)
                </label>
                <label className="menu-item check" title="Shade ICT fair value gaps (3-candle imbalances), extended 2 candles forward">
                  <input
                    type="checkbox"
                    checked={!!config.fvg}
                    onChange={() => onConfigChange({ ...config, fvg: !config.fvg })}
                  />
                  Fair value gaps
                </label>
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
          {POSITION_TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool tool-${t.cls}`}
              title={t.label}
              onClick={() => startDraw(t.id)}
            >
              {t.glyph}
            </button>
          ))}
          <button
            className="tool tool-trend"
            title="Trend line"
            onClick={() => startDraw("trendLine")}
          >
            ╱
          </button>
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
        {loading && (
          <div className="pane-loading" role="status" aria-live="polite">
            <div className="pane-loading-spinner" />
            <div className="pane-loading-label">
              Loading {config.symbol}<span className="pane-loading-sub"> · {config.source} · {config.interval}</span>
            </div>
          </div>
        )}
        {error && <div className="pane-error">{error}</div>}
        {/* Y-axis reset + unstick: returns to the default zoom / scroll /
            autoscale AND cancels any pending drawing + re-enables scroll+zoom
            in case they got flipped off. One-click recovery from any stuck
            state — armed drawing tool, manual y-scale drag, disabled scroll. */}
        <button
          type="button"
          className="reset-view"
          title="Reset chart & unstick (cancel drawing, re-enable pan/zoom)"
          aria-label="Reset chart and unstick"
          onClick={() => {
            // Cancel any drawing that's still waiting for anchor clicks —
            // otherwise all subsequent chart clicks are anchor placements, not
            // pans, and mouse drag can't move the chart.
            cancelPendingDraw();
            // Belt-and-braces: force scroll + zoom back on regardless of
            // whatever state the chart is in. Nothing external should ever be
            // turning these off, but this closes the loop if they do.
            const chart = chartRef.current;
            if (chart) {
              try { chart.setScrollEnabled(true); } catch {}
              try { chart.setZoomEnabled(true); } catch {}
            }
            resetView();
          }}
        >
          ⤾
        </button>
      </div>
    </div>
  );
}
