import React, { useCallback, useEffect, useRef, useState } from "react";
import { useReplay } from "../replay/ReplayProvider";

const SPEEDS = [1, 2, 4, 10];
const POS_KEY = "tm:replayBarPos";
const BAR_MARGIN = 8;

// Persist the floating bar's screen position so a refresh doesn't yank it back
// to the default corner. Falls back to a bottom-left anchor when there's no
// saved value (chosen because charts are usually centered and the top toolbar
// is busy).
function loadPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.x === "number" && typeof p.y === "number") return p;
    }
  } catch {}
  return { x: 16, y: Math.max(80, (typeof window !== "undefined" ? window.innerHeight : 800) - 80) };
}

function fmt(ts) {
  if (ts == null) return "—";
  return new Date(ts * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// <input type=date> value (YYYY-MM-DD) <-> unix seconds.
function tsToDateInput(ts) {
  if (ts == null) return "";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}
function dateInputToTs(v) {
  if (!v) return null;
  return Math.floor(new Date(v + "T23:59:59Z").getTime() / 1000);
}

export default function ReplayBar() {
  const {
    mode,
    setMode,
    playing,
    play,
    pause,
    speed,
    setSpeed,
    clock,
    range,
    displayTime,
    hasData,
    seek,
    stepBack,
    stepForward,
    endTs,
    setEndTs,
  } = useReplay();

  // Floating-bar drag state. Pointer events are used (unifies mouse + touch);
  // pointer capture keeps the drag alive even if the pointer leaves the handle.
  const barRef = useRef(null);
  const dragRef = useRef(null); // { dx, dy } offset from bar top-left at drag start
  const [pos, setPos] = useState(loadPos);

  const clampPos = useCallback((x, y) => {
    const bar = barRef.current;
    const w = bar ? bar.offsetWidth : 200;
    const h = bar ? bar.offsetHeight : 40;
    const maxX = Math.max(BAR_MARGIN, (typeof window !== "undefined" ? window.innerWidth : 1200) - w - BAR_MARGIN);
    const maxY = Math.max(BAR_MARGIN, (typeof window !== "undefined" ? window.innerHeight : 800) - h - BAR_MARGIN);
    return { x: Math.min(Math.max(BAR_MARGIN, x), maxX), y: Math.min(Math.max(BAR_MARGIN, y), maxY) };
  }, []);

  // Keep the bar inside the viewport when the window is resized (dragging it to
  // the far right and then shrinking the window would otherwise strand it).
  useEffect(() => {
    if (mode !== "replay") return;
    const onResize = () => setPos((p) => clampPos(p.x, p.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mode, clampPos]);

  // Persist the last-known position; runs on every drop (pointerup writes pos,
  // React re-renders, this effect flushes to localStorage).
  useEffect(() => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
  }, [pos]);

  const onHandleDown = (e) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  };
  const onHandleMove = (e) => {
    if (!dragRef.current) return;
    const nx = e.clientX - dragRef.current.dx;
    const ny = e.clientY - dragRef.current.dy;
    setPos(clampPos(nx, ny));
  };
  const onHandleUp = (e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  if (mode !== "replay") {
    return (
      <button className="count-group" onClick={() => setMode("replay")} title="Bar replay">
        <span style={{ padding: "4px 12px" }}>⏎ Replay</span>
      </button>
    );
  }

  return (
    <div
      ref={barRef}
      className="replay-bar floating"
      style={{ left: pos.x, top: pos.y }}
      role="toolbar"
      aria-label="Replay controls"
    >
      <span
        className="rb-handle"
        title="Drag to move"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      >
        ⋮⋮
      </span>
      <button className="rb-btn rb-exit" onClick={() => setMode("live")} title="Back to live">
        ✕ Live
      </button>

      <label className="rb-label">As of</label>
      <input
        type="date"
        className="rb-date"
        value={tsToDateInput(endTs)}
        onChange={(e) => setEndTs(dateInputToTs(e.target.value))}
        title="Load history up to this date (blank = latest)"
      />

      <button className="rb-btn" onClick={stepBack} title="Step back">⏮</button>
      <button className="rb-btn rb-play" onClick={playing ? pause : play} title={playing ? "Pause" : "Play"}>
        {playing ? "⏸" : "▶"}
      </button>
      <button className="rb-btn" onClick={stepForward} title="Step forward">⏭</button>

      <div className="rb-speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`rb-spd${s === speed ? " active" : ""}`}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>

      <input
        type="range"
        className="rb-scrub"
        min={range ? range.start : 0}
        max={range ? range.end : 1}
        value={clock ?? (range ? range.start : 0)}
        onChange={(e) => seek(Number(e.target.value))}
        disabled={!hasData}
      />
      <span className="rb-clock">{fmt(displayTime)}</span>
    </div>
  );
}
