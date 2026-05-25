import { useEffect, useRef, useState } from "react";
import { fetchCandles } from "../lib/api";
import { toKline } from "../lib/kline";
import { useReplay } from "../replay/ReplayProvider";

const REPLAY_BARS = 1500; // window size loaded per pane for a replay session

/**
 * Replay-mode data feed for a pane. Loads a window of history once, then reveals
 * candles with time <= the global wall-clock so all panes stay time-aligned.
 * No-op unless `enabled`.
 */
export function useReplayData({ paneId, source, symbol, interval, enabled, chartRef, ready, onPrice }) {
  const { clock, endTs, registerPane, unregisterPane } = useReplay();
  const dataRef = useRef([]);
  const renderedRef = useRef(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !ready) return;
    let cancelled = false;
    (async () => {
      try {
        const cs = await fetchCandles(source, symbol, interval, REPLAY_BARS, endTs);
        if (cancelled) return;
        dataRef.current = cs;
        renderedRef.current = 0;
        if (cs.length) {
          registerPane(paneId, {
            interval,
            minTime: cs[0].time,
            maxTime: cs[cs.length - 1].time,
          });
        }
        setVersion((v) => v + 1);
      } catch {
        dataRef.current = [];
      }
    })();
    return () => {
      cancelled = true;
      unregisterPane(paneId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, source, symbol, interval, endTs]);

  // Reveal candles up to the global clock.
  useEffect(() => {
    if (!enabled) return;
    const chart = chartRef.current;
    const arr = dataRef.current;
    if (!chart || !arr.length || clock == null) return;

    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].time <= clock) lo = mid + 1;
      else hi = mid;
    }
    const count = lo;

    if (count < renderedRef.current || renderedRef.current === 0) {
      chart.applyNewData(arr.slice(0, Math.max(1, count)).map(toKline));
    } else {
      for (let i = renderedRef.current; i < count; i++) chart.updateData(toKline(arr[i]));
    }
    renderedRef.current = count;
    if (count > 0) onPrice?.(arr[count - 1].close, arr[count - 1].time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, version, enabled]);
}
