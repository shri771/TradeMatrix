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

  // Seat the clock 25% into the window; re-seat when the range changes (panes load
  // asynchronously) or if it drifts outside the current range.
  useEffect(() => {
    if (mode !== "replay" || !range) return;
    setClock((c) =>
      c == null || c < range.start || c > range.end
        ? Math.round(range.start + (range.end - range.start) * 0.25)
        : c
    );
  }, [mode, range]);

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
    play: () => setPlaying(true),
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
