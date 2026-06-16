import { useEffect } from "react";
import { fetchCandles } from "../lib/api";
import { useStream } from "../ws/StreamProvider";

const INITIAL_BARS = 1500; // load a deep initial window; scroll-back loads more

/**
 * Loads historical candles, then subscribes to live updates for this pane.
 * Reports raw backend candles (time in seconds) via `onHistory` (full array) and
 * `onUpdate` (single candle per tick); the consumer feeds them to the chart.
 * Re-runs on source/symbol/interval change and unsubscribes on unmount.
 */
export function useCandleStream({ paneId, source, symbol, interval, enabled = true, onHistory, onUpdate, onError }) {
  const { subscribe, unsubscribe } = useStream();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function init() {
      try {
        const history = await fetchCandles(source, symbol, interval, INITIAL_BARS);
        if (cancelled) return;
        onHistory?.(history);
        onError?.(null);

        subscribe(paneId, { source, symbol, interval }, (msg) => {
          if (msg.error) {
            onError?.(msg.error);
            return;
          }
          if (msg.candle) onUpdate?.(msg.candle);
        });
      } catch (err) {
        if (!cancelled) onError?.(err.message || String(err));
      }
    }

    init();
    return () => {
      cancelled = true;
      unsubscribe(paneId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, source, symbol, interval, enabled]);
}
