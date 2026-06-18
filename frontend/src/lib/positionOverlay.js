import { registerOverlay } from "klinecharts";

// Long / Short position drawing tools, inspired by TradingView's tools of the
// same name. Three anchor clicks: entry, stop-loss, take-profit. The overlay
// paints a green profit zone (entry -> TP) and a red loss zone (entry -> SL)
// extending to the right edge of the chart, with horizontal lines, price labels,
// and a Risk:Reward readout.

const PROFIT_FILL = "rgba(38, 166, 154, 0.18)";
const LOSS_FILL = "rgba(239, 83, 80, 0.18)";
const PROFIT_LINE = "#26a69a";
const LOSS_LINE = "#ef5350";
const ENTRY_LINE = "#9aa4ad";
const LABEL_TEXT = "#dde3ec";

function num(n, p = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: p, maximumFractionDigits: p });
}

function makeTemplate(name, sideLabel) {
  return {
    name,
    totalStep: 4, // 3 clicks (entry, SL, TP) + finalised state
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,

    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (coordinates.length < 3) return []; // still being placed
      const [entry, sl, tp] = coordinates;
      const entryPrice = overlay.points[0]?.value ?? 0;
      const slPrice = overlay.points[1]?.value ?? 0;
      const tpPrice = overlay.points[2]?.value ?? 0;

      const xLeft = entry.x;
      const xRight = bounding.width;
      const rectW = Math.max(0, xRight - xLeft);

      // Profit zone (entry-y to TP-y). Loss zone (entry-y to SL-y).
      const profitTop = Math.min(entry.y, tp.y);
      const profitH = Math.abs(entry.y - tp.y);
      const lossTop = Math.min(entry.y, sl.y);
      const lossH = Math.abs(entry.y - sl.y);

      const profitPct = entryPrice ? ((tpPrice - entryPrice) / entryPrice) * 100 : 0;
      const lossPct = entryPrice ? ((slPrice - entryPrice) / entryPrice) * 100 : 0;
      const risk = Math.abs(entryPrice - slPrice);
      const reward = Math.abs(tpPrice - entryPrice);
      const rr = risk > 0 ? reward / risk : 0;

      const labelX = Math.max(xLeft + 6, xRight - 6);
      const labelAttrs = (x, y, text, baseline = "middle") => ({
        x, y, text, baseline, align: "right",
      });

      return [
        // Filled zones (visual only — don't intercept overlay drag).
        {
          type: "rect",
          ignoreEvent: true,
          attrs: { x: xLeft, y: profitTop, width: rectW, height: profitH },
          styles: { style: "fill", color: PROFIT_FILL },
        },
        {
          type: "rect",
          ignoreEvent: true,
          attrs: { x: xLeft, y: lossTop, width: rectW, height: lossH },
          styles: { style: "fill", color: LOSS_FILL },
        },
        // Horizontal lines at each level (these carry the hit-test for dragging).
        {
          type: "line",
          attrs: { coordinates: [{ x: xLeft, y: entry.y }, { x: xRight, y: entry.y }] },
          styles: { color: ENTRY_LINE, size: 1, style: "dashed", dashedValue: [4, 3] },
        },
        {
          type: "line",
          attrs: { coordinates: [{ x: xLeft, y: tp.y }, { x: xRight, y: tp.y }] },
          styles: { color: PROFIT_LINE, size: 1 },
        },
        {
          type: "line",
          attrs: { coordinates: [{ x: xLeft, y: sl.y }, { x: xRight, y: sl.y }] },
          styles: { color: LOSS_LINE, size: 1 },
        },
        // Side badge near the entry line.
        {
          type: "text",
          ignoreEvent: true,
          attrs: { x: xLeft + 4, y: entry.y - 2, text: sideLabel, baseline: "bottom" },
          styles: { color: sideLabel === "LONG" ? PROFIT_LINE : LOSS_LINE, size: 11, weight: "bold" },
        },
        // Per-level labels: price + percentage, anchored to the right edge.
        {
          type: "text",
          ignoreEvent: true,
          attrs: labelAttrs(labelX, tp.y, `TP ${num(tpPrice)}  ${profitPct >= 0 ? "+" : ""}${num(profitPct)}%`),
          styles: { color: PROFIT_LINE, size: 11 },
        },
        {
          type: "text",
          ignoreEvent: true,
          attrs: labelAttrs(labelX, entry.y, `Entry ${num(entryPrice)}`),
          styles: { color: LABEL_TEXT, size: 11 },
        },
        {
          type: "text",
          ignoreEvent: true,
          attrs: labelAttrs(labelX, sl.y, `SL ${num(slPrice)}  ${lossPct >= 0 ? "+" : ""}${num(lossPct)}%`),
          styles: { color: LOSS_LINE, size: 11 },
        },
        // R:R readout centred between entry and TP for prominence.
        {
          type: "text",
          ignoreEvent: true,
          attrs: labelAttrs(labelX, (entry.y + tp.y) / 2, `R:R ${num(rr)}`),
          styles: { color: PROFIT_LINE, size: 12, weight: "bold" },
        },
      ];
    },
  };
}

let registered = false;
export function registerPositionOverlays() {
  if (registered) return;
  registered = true;
  registerOverlay(makeTemplate("longPosition", "LONG"));
  registerOverlay(makeTemplate("shortPosition", "SHORT"));
}
