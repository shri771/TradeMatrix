import React, { useEffect, useRef, useState } from "react";
import ChartPane from "./ChartPane";

// Cleanest column count for each chart count (rows flow automatically).
const COLUMNS = { 1: 1, 2: 2, 4: 2, 6: 3, 8: 4 };
const GUTTER = 6; // px hit area between panes (draggable)
const MIN_PX = 50; // a pane can't be dragged narrower/shorter than this
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
  const [drag, setDrag] = useState(null); // { type, index } of the active gutter
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
    setAllSizes((prev) => ({ ...prev, [key]: { ...sizes, [type]: arr } }));
  };

  // Track the cursor's pixel position within the dragged pair so the divider
  // follows the mouse 1:1 on any screen size (no proportional speed-up).
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const cursor = d.type === "cols" ? e.clientX : e.clientY;
    let boundary = cursor - d.pairStart;
    boundary = Math.max(MIN_PX, Math.min(d.pairPx - MIN_PX, boundary));
    const fracA = d.pairFr * (boundary / d.pairPx);
    const arr = [...d.snapshot];
    arr[d.index] = fracA;
    arr[d.index + 1] = d.pairFr - fracA;
    setTrack(d.type, arr);
  };

  const endDrag = () => {
    dragRef.current = null;
    setDrag(null);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  };

  const startDrag = (type, index, e) => {
    e.preventDefault();
    const grid = gridRef.current;
    const attr = type === "cols" ? "data-col" : "data-row";
    const a = grid.querySelector(`[${attr}="${index}"]`);
    const b = grid.querySelector(`[${attr}="${index + 1}"]`);
    if (!a || !b) return;
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const pairStart = type === "cols" ? ra.left : ra.top;
    const pairEnd = type === "cols" ? rb.right : rb.bottom;
    dragRef.current = {
      type,
      index,
      snapshot: [...sizes[type]],
      pairFr: sizes[type][index] + sizes[type][index + 1],
      pairStart,
      pairPx: pairEnd - pairStart,
    };
    setDrag({ type, index });
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  };

  // Build templates with gutter tracks interleaved between content tracks.
  const colTemplate = sizes.cols
    .map((f) => `minmax(40px, ${f}fr)`)
    .join(` ${GUTTER}px `);
  const rowTemplate = sizes.rows
    .map((f) => `minmax(40px, ${f}fr)`)
    .join(` ${GUTTER}px `);

  const isActive = (type, index) => drag && drag.type === type && drag.index === index;

  return (
    <div
      ref={gridRef}
      className={`grid${drag ? " dragging" : ""}`}
      style={{ gridTemplateColumns: colTemplate, gridTemplateRows: rowTemplate }}
    >
      {Array.from({ length: count }, (_, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        return (
          <div
            key={i}
            className="pane-cell"
            data-col={c}
            data-row={r}
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
          className={`gutter gutter-col${isActive("cols", j) ? " active" : ""}`}
          style={{ gridColumn: 2 * j + 2, gridRow: "1 / -1" }}
          onPointerDown={(e) => startDrag("cols", j, e)}
        />
      ))}

      {/* Row gutters: full-width horizontal dividers */}
      {Array.from({ length: rows - 1 }, (_, i) => (
        <div
          key={`r${i}`}
          className={`gutter gutter-row${isActive("rows", i) ? " active" : ""}`}
          style={{ gridRow: 2 * i + 2, gridColumn: "1 / -1" }}
          onPointerDown={(e) => startDrag("rows", i, e)}
        />
      ))}
    </div>
  );
}
