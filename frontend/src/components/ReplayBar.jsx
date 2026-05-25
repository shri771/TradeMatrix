import React from "react";
import { useReplay } from "../replay/ReplayProvider";

const SPEEDS = [1, 2, 4, 10];

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

  if (mode !== "replay") {
    return (
      <button className="count-group" onClick={() => setMode("replay")} title="Bar replay">
        <span style={{ padding: "4px 12px" }}>⏎ Replay</span>
      </button>
    );
  }

  return (
    <div className="replay-bar">
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
