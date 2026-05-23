import React, { useEffect, useRef, useState } from "react";
import ChartPane from "./ChartPane";

// Cleanest column count for each chart count (rows flow automatically).
const COLUMNS = { 1: 1, 2: 2, 4: 2, 6: 3, 8: 4 };
const GUTTER = 6; // px between panes (draggable)
const MIN_FR = 0.18; // a track can't be dragged smaller than this fraction
const SIZES_KEY = "tm:sizes";

function loadSizes() {
  try {
    return JSON.parse(localStorage.getItem(SIZES_KEY)) ?? {};
  } catch {
    return {};
  }
}

export default function ChartGrid({ count, panes, sources, onPaneChange }) {
  const cols = COLUMNS[count] ?? 2;
  const rows = Math.ceil(count / cols);
  const key = String(count);

  const [allSizes, setAllSizes] = useState(loadSizes);
  const [dragging, setDragging] = useState(false);
  const gridRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(SIZES_KEY, JSON.stringify(allSizes));
  }, [allSizes]);

  // Sizes for the current count; fall back to equal tracks (and self-heal if the
  // stored shape no longer matches this layout, e.g. after a code change).
  const stored = allSizes[key];
  const sizes =
    stored && stored.cols?.length === cols && stored.rows?.length === rows
      ? stored
      : { cols: Array(cols).fill(1), rows: Array(rows).fill(1) };

  const setTrack = (type, arr) => {
    setAllSizes((prev) => ({
      ...prev,
      [key]: { ...sizes, [type]: arr },
    }));
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const pos = d.type === "cols" ? e.clientX : e.clientY;
    const total = d.snapshot.reduce((a, b) => a + b, 0);
    const deltaFr = ((pos - d.startPos) / d.extent) * total;
    const arr = [...d.snapshot];
    const pairSum = arr[d.index] + arr[d.index + 1];
    let a = Math.max(MIN_FR, Math.min(pairSum - MIN_FR, arr[d.index] + deltaFr));
    arr[d.index] = a;
    arr[d.index + 1] = pairSum - a;
    setTrack(d.type, arr);
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  };

  const startDrag = (type, index, e) => {
    e.preventDefault();
    const rect = gridRef.current.getBoundingClientRect();
    const gutterCount = (type === "cols" ? cols : rows) - 1;
    const extent =
      (type === "cols" ? rect.width : rect.height) - gutterCount * GUTTER;
    dragRef.current = {
      type,
      index,
      startPos: type === "cols" ? e.clientX : e.clientY,
      snapshot: [...sizes[type]],
      extent,
    };
    setDragging(true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  };

  // Build templates with gutter tracks interleaved between content tracks.
  const colTemplate = sizes.cols
    .map((f) => `minmax(80px, ${f}fr)`)
    .join(` ${GUTTER}px `);
  const rowTemplate = sizes.rows
    .map((f) => `minmax(60px, ${f}fr)`)
    .join(` ${GUTTER}px `);

  return (
    <div
      ref={gridRef}
      className={`grid${dragging ? " dragging" : ""}`}
      style={{ gridTemplateColumns: colTemplate, gridTemplateRows: rowTemplate }}
    >
      {Array.from({ length: count }, (_, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        return (
          <div
            key={i}
            className="pane-cell"
            style={{ gridColumn: 2 * c + 1, gridRow: 2 * r + 1 }}
          >
            <ChartPane
              paneId={i}
              config={panes[i]}
              sources={sources}
              onConfigChange={(next) => onPaneChange(i, next)}
            />
          </div>
        );
      })}

      {/* Column gutters: full-height vertical dividers */}
      {Array.from({ length: cols - 1 }, (_, j) => (
        <div
          key={`c${j}`}
          className="gutter gutter-col"
          style={{ gridColumn: 2 * j + 2, gridRow: "1 / -1" }}
          onPointerDown={(e) => startDrag("cols", j, e)}
        />
      ))}

      {/* Row gutters: full-width horizontal dividers */}
      {Array.from({ length: rows - 1 }, (_, i) => (
        <div
          key={`r${i}`}
          className="gutter gutter-row"
          style={{ gridRow: 2 * i + 2, gridColumn: "1 / -1" }}
          onPointerDown={(e) => startDrag("rows", i, e)}
        />
      ))}
    </div>
  );
}
