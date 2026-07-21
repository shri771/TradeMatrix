import { useEffect, useRef, useState } from "react";
import { init, dispose } from "klinecharts";
import { CHART_STYLES } from "../lib/chartTheme";
import { INTERVAL_SECONDS } from "../lib/kline";

// KLineChart's FormatDateType enum: 0=Tooltip, 1=Crosshair, 2=XAxis.
const XAXIS_TYPE = 2;

/**
 * Build a date formatter that shows "HH:mm" on the X-axis for intraday intervals
 * (<= 1h), and falls back to KLineChart's default format string for higher
 * timeframes AND for tooltip/crosshair contexts (which stay full-detail).
 */
function makeFormatDate(intervalSec) {
  return (dateTimeFormat, timestamp, format, type) => {
    // KLineChart's draw pipeline is inside the render loop — anything we throw
    // here silently kills the frame. Belt-and-braces guard against malformed
    // args (invalid timestamps, missing format string) so we always return a
    // string and never blow up the chart.
    try {
      if (!Number.isFinite(timestamp)) return "";
      const useHourMinute = type === XAXIS_TYPE && intervalSec <= 3600;
      const effectiveFormat = useHourMinute ? "HH:mm" : (typeof format === "string" ? format : "YYYY-MM-DD HH:mm");
      const parts = dateTimeFormat.formatToParts(new Date(timestamp));
      const p = {};
      for (const part of parts) p[part.type] = part.value;
      return effectiveFormat
        .replace(/YYYY/g, p.year ?? "")
        .replace(/MM/g, p.month ?? "")
        .replace(/DD/g, p.day ?? "")
        .replace(/HH/g, p.hour ?? "00")
        .replace(/mm/g, p.minute ?? "00")
        .replace(/ss/g, p.second ?? "00");
    } catch {
      return "";
    }
  };
}

/**
 * Wraps the KLineChart instance lifecycle. Returns a ref for the chart host div,
 * a ref to the chart instance, and a `ready` flag once the chart exists.
 * Resizes the chart when its container changes size (e.g. grid gutter drag).
 *
 * Pass the pane's current `interval` so the x-axis format tracks it (HH:mm on
 * intraday, default format on 4h+).
 */
export function useChart(interval) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const initialBarSpaceRef = useRef(null);
  const initialOffsetRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = init(host, { styles: CHART_STYLES });
    // Fixed UTC-4. IANA `Etc/GMT+4` means "4 hours behind UTC" (the sign is
    // inverted in the Etc/GMT zones by design), so this locks NY summer time
    // year-round and does NOT flip to UTC-5 in winter.
    try { chart.setTimezone("Etc/GMT+4"); } catch {}
    // Explicitly guarantee TradingView-style click-drag panning + wheel zoom.
    // These default to true in v9 but making them explicit protects against
    // any future default flip and gives the setting a single grep-able home.
    try { chart.setScrollEnabled(true); } catch {}
    try { chart.setZoomEnabled(true); } catch {}
    // Snapshot the default zoom + right-offset so the "reset" button below
    // can return to exactly this framing. Guard against a 0-width bar space
    // snapshot: on a freshly-created chart getBarSpace() can briefly return 0
    // before the layout settles, and later feeding 0 into setBarSpace paints
    // candles with zero width (i.e. invisible). Fall back to the KLineChart
    // default of 6 in that case.
    try {
      const bs = chart.getBarSpace();
      initialBarSpaceRef.current = bs && bs > 0 ? bs : 6;
    } catch { initialBarSpaceRef.current = 6; }
    try { initialOffsetRef.current = chart.getOffsetRightDistance(); } catch {}
    chartRef.current = chart;
    setReady(true);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(host);

    return () => {
      ro.disconnect();
      dispose(host);
      chartRef.current = null;
      setReady(false);
    };
  }, []);

  // Re-install the date formatter whenever the interval changes, so an intraday
  // switch swaps the x-axis to HH:mm and a switch to 4h/1d restores full dates.
  // Also re-assert scroll+zoom here — some code paths (indicator create, pane
  // options change) can silently toggle them off, and re-enabling on every
  // interval change is cheap insurance that click-drag panning stays alive.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    const sec = INTERVAL_SECONDS[interval] || 60;
    try { chart.setCustomApi({ formatDate: makeFormatDate(sec) }); } catch {}
    try { chart.setScrollEnabled(true); } catch {}
    try { chart.setZoomEnabled(true); } catch {}
  }, [interval, ready]);

  // Keyboard pan fallback — arrow keys pan the chart, +/- zoom. Useful when the
  // mouse-drag pan is being intercepted (armed drawing tool, overlay selection)
  // and the user just wants to move the chart.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e) => {
      const chart = chartRef.current;
      if (!chart) return;
      // Ignore when typing in an input/select — arrow keys should navigate text.
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const bs = (() => { try { return chart.getBarSpace() || 6; } catch { return 6; } })();
      const step = bs * 10;
      switch (e.key) {
        case "ArrowLeft":  try { chart.scrollByDistance(-step, 120); } catch {} break;
        case "ArrowRight": try { chart.scrollByDistance(step, 120); } catch {} break;
        case "+": case "=": try { chart.zoomAtCoordinate(1.15); } catch {} break;
        case "-": case "_": try { chart.zoomAtCoordinate(0.85); } catch {} break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);

  // Restore the chart to its first-open framing:
  //   - default bar spacing (undo user zoom in/out)
  //   - right-side offset back to the value we snapshotted at init
  //   - x-scroll back to the newest bar
  //   - y-axis autoscale (re-init the axis to drop any manual drag-scaling)
  // This is what the on-canvas "⤾" button in ChartPane calls.
  const resetView = () => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const bs = initialBarSpaceRef.current;
      if (bs) chart.setBarSpace(bs);
    } catch {}
    try {
      const off = initialOffsetRef.current;
      if (off != null) chart.setOffsetRightDistance(off);
    } catch {}
    try { chart.setScrollEnabled(true); } catch {}
    try { chart.setZoomEnabled(true); } catch {}
    try { chart.scrollToRealTime(200); } catch {}
  };

  return { hostRef, chartRef, ready, resetView };
}
