import { registerOverlay } from "klinecharts";

// Custom Fibonacci-line overlay. Registers under the same `fibonacciLine` name as
// KLineChart's built-in, so this REPLACES it — the ✎ menu's "Fibonacci" entry uses
// these levels instead of the stock 0.236 / 0.382 / 0.5 / 0.618 / 0.786 grid.
//
// Levels chosen per the trader's ask: 0, -4, -2, 2.5, 1, 0.5. Negative values sit
// below the p1 anchor; values > 1 sit above the p2 anchor (extensions).

const LEVELS = [-4, -2.5, -2, 0, 0.5, 1, 2.5];

// Semantic colours: solid for the two anchors, dashed for retrace/extension.
const COLOR_ANCHOR = "#aeb6c2";      // levels 0 and 1
const COLOR_RETRACE = "#26a69a";     // levels between 0 and 1 (0.5)
const COLOR_EXTENSION = "#f0b90b";   // levels outside [0, 1] (-4, -2, 2.5)
const COLOR_BASE = "#7d8790";        // faint line between the two anchor clicks
const PILL_TEXT = "#0e1117";

// Overlay IDs currently selected — used to conditionally render the per-overlay
// delete pill. Populated by onSelected / cleared by onDeselected. Module-scoped
// because the template registers once at module load. Cross-pane clicks flow
// through the "tm:delete-overlay" DOM event that ChartPane listens for.
const selectedIds = new Set();

function levelColor(r) {
  if (r === 0 || r === 1) return COLOR_ANCHOR;
  if (r > 0 && r < 1) return COLOR_RETRACE;
  return COLOR_EXTENSION;
}

function fmtPrice(p) {
  if (!Number.isFinite(p)) return "—";
  const decimals = Math.abs(p) >= 100 ? 2 : Math.abs(p) >= 1 ? 3 : 5;
  return p.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

let registered = false;
export function registerFibonacciOverlay() {
  if (registered) return;
  registered = true;
  registerOverlay({
    name: "fibonacciLine",
    // 3 clicks: p1 (anchor 0), p2 (anchor 1), right-edge handle (x extent).
    // The right-edge handle is a pure x-drag — its y is snapped to p1's price
    // so the user only has to think about "how far right".
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,

    // Post-draw drag: keep the right-edge handle horizontally free but locked
    // vertically to p1's price. Without this, dragging the handle drifts the
    // levels around because its y feeds into nothing sensible.
    performEventPressedMove: ({ points, performPointIndex }) => {
      if (performPointIndex === 2 && points[0] && points[2]) {
        points[2] = { ...points[2], value: points[0].value };
      }
    },
    // While the user is placing the 3rd click, preview it snapped to p1's y.
    performEventMoveForDrawing: ({ currentStep, points, performPoint }) => {
      if (currentStep === 3 && points[0]) {
        return { ...performPoint, value: points[0].value };
      }
      return performPoint;
    },

    onSelected: ({ overlay }) => {
      selectedIds.add(overlay.id);
      return false;
    },
    onDeselected: ({ overlay }) => {
      selectedIds.delete(overlay.id);
      return false;
    },
    onClick: ({ figureKey, overlay }) => {
      if (figureKey === "delete") {
        try {
          window.dispatchEvent(new CustomEvent("tm:delete-overlay", { detail: overlay.id }));
        } catch {}
        return true;
      }
      return false;
    },
    onRemoved: ({ overlay }) => {
      selectedIds.delete(overlay.id);
      return false;
    },

    createPointFigures: ({ coordinates, overlay, bounding }) => {
      if (coordinates.length < 2) return [];
      const [p1, p2, edge] = coordinates;
      const price1 = overlay.points[0]?.value ?? 0;
      const price2 = overlay.points[1]?.value ?? 0;
      const priceRange = price2 - price1;
      const yRange = p2.y - p1.y;

      // Left edge = the leftmost of the two anchors.
      // Right edge = the 3rd anchor if placed & to the right of xLeft; while
      // the user's still picking the 3rd click, fall back to the chart edge.
      const xLeft = Math.min(p1.x, p2.x);
      const xRight = edge && edge.x > xLeft ? edge.x : bounding.width;

      const figs = [];

      // Faint dashed baseline connecting the two anchor clicks — matches the
      // stock built-in's UX affordance so the user knows where they clicked.
      figs.push({
        type: "line",
        attrs: { coordinates: [{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }] },
        styles: { color: COLOR_BASE, size: 1, style: "dashed", dashedValue: [3, 3] },
      });

      // Per-overlay delete pill — visible only while selected. Placed above the
      // highest visible level line at the right edge. Fires the global
      // "tm:delete-overlay" event that ChartPane routes back to the chart.
      if (selectedIds.has(overlay.id)) {
        const topY = Math.min(...LEVELS.map((r) => p1.y + yRange * r));
        figs.push({
          type: "text",
          key: "delete",
          attrs: {
            x: xRight - 6,
            y: topY - 16,
            text: "×",
            align: "right",
            baseline: "middle",
          },
          styles: {
            color: "#ffffff",
            backgroundColor: "#ef5350",
            borderColor: "#ef5350",
            borderRadius: 10,
            paddingLeft: 7,
            paddingRight: 7,
            paddingTop: 2,
            paddingBottom: 2,
            size: 13,
            weight: "bold",
          },
        });
      }

      // One horizontal per Fibonacci level, clipped to [xLeft, xRight] — the
      // user controls the right end with the 3rd anchor, no more infinity-run.
      for (const r of LEVELS) {
        const y = p1.y + yRange * r;
        const price = price1 + priceRange * r;
        const color = levelColor(r);
        const isAnchor = r === 0 || r === 1;

        figs.push({
          type: "line",
          attrs: { coordinates: [{ x: xLeft, y }, { x: xRight, y }] },
          styles: {
            color,
            size: isAnchor ? 1.25 : 1,
            style: isAnchor ? "solid" : "dashed",
            dashedValue: [5, 4],
          },
        });

        figs.push({
          type: "text",
          ignoreEvent: true,
          attrs: {
            x: xRight - 4,
            y,
            text: `${r}  ${fmtPrice(price)}`,
            align: "right",
            baseline: "middle",
          },
          styles: {
            color: PILL_TEXT,
            backgroundColor: color,
            borderColor: color,
            borderRadius: 3,
            paddingLeft: 5,
            paddingRight: 5,
            paddingTop: 2,
            paddingBottom: 2,
            size: 10,
            weight: isAnchor ? "bold" : "normal",
          },
        });
      }

      return figs;
    },
  });
}
