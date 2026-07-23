import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { INTERVAL_SECONDS } from "../lib/kline";

const ReplayContext = createContext(null);

const TICK_MS = 200;
// When play is pressed from the end of the window, rewind by this many bars so
// candles replay forward — but no further, so the earlier bars stay on the left
// as history instead of the chart resetting to a single candle.
const REPLAY_START_LOOKBACK_BARS = 300;

/**
 * Global replay on an ABSOLUTE wall-clock. Every pane reveals candles with
 * time <= clock, so all charts show the same moment. The clock spans
 * [latest pane-start, latest pane-end] so it sits where every pane has data;
 * panes whose data ends earlier (closed markets) freeze at their last bar.
 */
export function ReplayProvider({ children }) {
  const [mode, setModeState] = useState("live"); // "live" | "replay"
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [clock, setClock] = useState(null); // unix seconds
  const [endTs, setEndTs] = useState(null); // "as of" date for fetching (null = latest)
  const [panesMeta, setPanesMeta] = useState({});

  const range = useMemo(() => {
    const metas = Object.values(panesMeta).filter((m) => m.minTime != null && m.maxTime != null);
    if (!metas.length) return null;
    return {
      start: Math.max(...metas.map((m) => m.minTime)),
      end: Math.max(...metas.map((m) => m.maxTime)),
    };
  }, [panesMeta]);

  const finestSec = useMemo(() => {
    const secs = Object.values(panesMeta).map((m) => INTERVAL_SECONDS[m.interval] || 60);
    return secs.length ? Math.min(...secs) : 60;
  }, [panesMeta]);

  const registerPane = useCallback((id, meta) => {
    setPanesMeta((prev) => ({ ...prev, [id]: meta }));
  }, []);
  const unregisterPane = useCallback((id) => {
    setPanesMeta((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const setMode = useCallback((m) => {
    setModeState(m);
    setPlaying(false);
    if (m === "replay") setClock(null);
  }, []);

  // Seat the clock, re-seating whenever the range changes (panes load asynchronously)
  // or the clock drifts outside it. Always land near the END of the window (~99%)
  // so entering replay LOOKS like the live view — same latest bars visible, chart
  // doesn't feel "reset". If the user wants to review a specific past period, they
  // drag the scrubber back OR pick an "As of" date (which lands near the end of
  // THAT window, not the current one). Rewinding is what the scrubber and step-
  // back controls are for; play just walks forward from wherever the clock is.
  useEffect(() => {
    if (mode !== "replay" || !range) return;
    setClock((c) =>
      c == null || c < range.start || c > range.end
        ? Math.round(range.start + (range.end - range.start) * 0.99)
        : c
    );
  }, [mode, range, endTs]);

  useEffect(() => {
    if (!playing || mode !== "replay" || !range) return;
    const id = setInterval(() => {
      setClock((c) => {
        const next = (c ?? range.start) + finestSec * speed * (TICK_MS / 1000);
        if (next >= range.end) {
          setPlaying(false);
          return range.end;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, mode, speed, finestSec, range]);

  const clamp = useCallback((t) => (range ? Math.max(range.start, Math.min(range.end, t)) : t), [range]);

  const value = {
    mode,
    setMode,
    playing,
    // Play forward. On entry the clock is seated at ~99% of the window so replay
    // "looks like live" — but pressing play there (or after a run has parked the
    // clock at range.end) leaves nothing to advance: the first tick hits range.end
    // and immediately pauses, which reads as "play does nothing". So when we're
    // at/near the end, rewind — but only by a bounded lookback (capped at half the
    // window), NOT all the way to range.start, so the earlier bars stay visible on
    // the left as history instead of the chart collapsing to a single candle. A
    // clock the user has scrubbed into the middle is left alone — play resumes there.
    play: () => {
      setClock((c) => {
        if (!range) return c;
        const span = range.end - range.start;
        const atEnd = c == null || c >= range.end - span * 0.02;
        if (!atEnd) return c;
        const lookback = Math.min(REPLAY_START_LOOKBACK_BARS * finestSec, span * 0.5);
        return range.end - lookback;
      });
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    speed,
    setSpeed,
    clock,
    range,
    hasData: !!range,
    displayTime: clock,
    seek: (t) => setClock(clamp(t)),
    stepForward: () => setClock((c) => clamp((c ?? range?.start ?? 0) + finestSec)),
    stepBack: () => setClock((c) => clamp((c ?? range?.start ?? 0) - finestSec)),
    endTs,
    setEndTs: (ts) => {
      setEndTs(ts);
      setClock(null); // refetch re-seats the clock into the new window
    },
    registerPane,
    unregisterPane,
  };

  return <ReplayContext.Provider value={value}>{children}</ReplayContext.Provider>;
}

export function useReplay() {
  const ctx = useContext(ReplayContext);
  if (!ctx) throw new Error("useReplay must be used within ReplayProvider");
  return ctx;
}
