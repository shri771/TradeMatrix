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
export function useReplayData({ paneId, source, symbol, interval, enabled, chartRef, ready, onPrice, onLoading }) {
  const { clock, endTs, registerPane, unregisterPane } = useReplay();
  const dataRef = useRef([]);
  const renderedRef = useRef(0);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled || !ready) return;
    let cancelled = false;
    (async () => {
      onLoading?.(true);
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
      } finally {
        if (!cancelled) onLoading?.(false);
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

    // Split the work: applyNewData when the data set fundamentally changes
    // (first render after a fetch, or the clock jumped backwards), updateData
    // when we're just appending new bars during play. This is critical because
    // applyNewData auto-scrolls the chart back to the latest bar — using it
    // every tick would snap scroll on every 200ms and make the chart feel
    // unpannable during play.
    //
    // When we DO applyNewData (fetch change), also release the y-axis manual-
    // scale flag so the new price range fits — setStyles({yAxis:{type:"normal"}})
    // is the documented handle that flips Axis._autoCalcTickFlag back to true
    // (see klinecharts ChartImp.setStyles).
    if (renderedRef.current === 0 || count < renderedRef.current) {
      if (count > 0) {
        chart.applyNewData(arr.slice(0, count).map(toKline));
        try { chart.setStyles({ yAxis: { type: "normal" } }); } catch {}
      }
    } else {
      // Append the newly-revealed bars. updateData keeps the chart's right-side
      // offset (`lastBarRightSideDiffBarCount`) constant while the data grows,
      // so the visible window advances by exactly one bar per append and the new
      // candle streams in at the right edge on its own — no manual scroll needed.
      //
      // An earlier version added `scrollByDistance(-added * barSpace)` here to
      // "nudge the view forward". That was backwards: klinecharts treats a
      // negative distance as scrolling toward OLDER data, so it fought the
      // natural streaming every tick and pinned the candles in place while the
      // clock kept moving (the "5min candles freeze on play" bug). Removed.
      for (let i = renderedRef.current; i < count; i++) {
        chart.updateData(toKline(arr[i]));
      }
    }
    renderedRef.current = count;
    if (count > 0) onPrice?.(arr[count - 1].close, arr[count - 1].time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, version, enabled]);
}
