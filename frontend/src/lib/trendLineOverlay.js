import { registerOverlay } from "klinecharts";

// Horizontal "trend line" — a bounded segment that is locked to the PRICE of the
// first click, so it stays perfectly level (180°) no matter where the second
// click lands. Two clicks: the first anchors the price + start, the second only
// sets how far the line runs (its length / end time).
//
// This is distinct from the full-width Horizontal line tool: this one is bounded
// to a time span, so you can mark support/resistance over a specific window.

const COLOR = "#2962ff"; // klinecharts default overlay blue

let registered = false;
export function registerTrendLineOverlay() {
  if (registered) return;
  registered = true;
  registerOverlay({
    name: "trendLine",
    totalStep: 3, // click 1 (anchor) + click 2 (length) + finalised
    needDefaultPointFigure: true,
    // No default axis figures: they draw a FULL-WIDTH price line (and full-height
    // time line) at each anchor. On a finer timeframe where the bounded segment
    // scrolls off-screen, that stray full-width line is all that's left — it reads
    // as the trend line "extending to infinity". We only want the bounded segment.
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,

    // While placing the 2nd point, preview it snapped to the anchor's price so
    // the rubber-band line stays level as the cursor moves.
    performEventMoveForDrawing: ({ currentStep, points, performPoint }) => {
      if (currentStep === 2 && points[0]) {
        return { ...performPoint, value: points[0].value };
      }
      return performPoint;
    },

    // After it's drawn, keep it level when an endpoint is dragged: dragging the
    // 2nd point changes only its time; dragging the anchor moves the whole line
    // to a new price and takes the 2nd point with it.
    performEventPressedMove: ({ points, performPointIndex }) => {
      if (performPointIndex === 1 && points[0]) {
        points[1] = { ...points[1], value: points[0].value };
      } else if (performPointIndex === 0 && points[1]) {
        points[1] = { ...points[1], value: points[0].value };
      }
    },

    createPointFigures: ({ coordinates, bounding }) => {
      if (coordinates.length < 2) return [];
      const [p1, p2] = coordinates;
      // Clamp the segment's x to the chart width. On a coarser timeframe an anchor
      // whose timestamp is outside the loaded/revealed data extrapolates to a huge
      // off-screen x; drawing to it made the bounded line look like it ran to
      // infinity. Clamping keeps it within the visible chart. (y is p1's price so
      // the segment stays perfectly level even if the anchors drift a sub-pixel.)
      const w = bounding?.width ?? 0;
      const clampX = (x) => (w > 0 ? Math.max(-1, Math.min(w + 1, x)) : x);
      return [
        {
          type: "line",
          attrs: { coordinates: [{ x: clampX(p1.x), y: p1.y }, { x: clampX(p2.x), y: p1.y }] },
          styles: { color: COLOR, size: 1 },
        },
      ];
    },
  });
}
