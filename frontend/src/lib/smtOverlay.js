import { registerOverlay } from "klinecharts";

// SMT (Smart Money Technique) divergence line overlay. Draws a segment between
// two swing points on the main chart, plus a small labeled pill at the midpoint
// naming the correlate the current symbol diverges from (e.g. "vs ES" or "vs YM").
//
// Configured via `extendData` on the overlay create call:
//   { correlate: "ES", direction: "bearish" | "bullish" }
//
// Color comes from `direction`: red for bearish, teal for bullish — same
// convention as long/short position tools so the semantics carry across.

const COLOR_BEARISH = "#ef5350";
const COLOR_BULLISH = "#26a69a";
const PILL_TEXT = "#0e1117";

let registered = false;
export function registerSmtOverlay() {
  if (registered) return;
  registered = true;
  registerOverlay({
    name: "smtLine",
    totalStep: 3, // 2 anchor points + finalised (drawn programmatically)
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    lock: true, // never draggable — these are computed, not user-drawn

    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const [p1, p2] = coordinates;
      const ext = overlay.extendData || {};
      const color = ext.direction === "bullish" ? COLOR_BULLISH : COLOR_BEARISH;
      const label = ext.correlate ? `SMT vs ${ext.correlate}` : "SMT";

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      return [
        // The divergence trend line itself.
        {
          type: "line",
          ignoreEvent: true,
          attrs: { coordinates: [p1, p2] },
          styles: { color, size: 1.5, style: "solid" },
        },
        // Small tick at each swing endpoint so the line's exact touch points
        // are visible on top of the candles.
        {
          type: "circle",
          ignoreEvent: true,
          attrs: { x: p1.x, y: p1.y, r: 3 },
          styles: { style: "fill", color },
        },
        {
          type: "circle",
          ignoreEvent: true,
          attrs: { x: p2.x, y: p2.y, r: 3 },
          styles: { style: "fill", color },
        },
        // Labeled pill at the midpoint. the text figure auto-sizes to its content.
        {
          type: "text",
          ignoreEvent: true,
          attrs: {
            x: midX,
            y: midY,
            text: label,
            align: "center",
            baseline: "middle",
          },
          styles: {
            color: PILL_TEXT,
            backgroundColor: color,
            borderColor: color,
            borderRadius: 4,
            paddingLeft: 6,
            paddingRight: 6,
            paddingTop: 2,
            paddingBottom: 2,
            size: 10,
            weight: "bold",
          },
        },
      ];
    },
  });
}
