import { registerOverlay } from "klinecharts";

// Long / Short position drawing tools, inspired by TradingView's tools of the
// same name. Three anchor clicks: entry, stop-loss, take-profit. The overlay
// paints a green profit zone (entry -> TP) and a red loss zone (entry -> SL)
// extending to the right edge, with anchored pill labels for each level and a
// prominent R:R badge near the entry.

// ---- Theme ----
const PROFIT_FILL = "rgba(38, 166, 154, 0.20)";
const LOSS_FILL = "rgba(239, 83, 80, 0.18)";
const PROFIT = "#26a69a";
const LOSS = "#ef5350";
const ENTRY = "#aeb6c2";
const TEXT_ON_COLOR = "#0e1117";
const NEUTRAL_BG = "#1f2933";
const NEUTRAL_TEXT = "#dde3ec";

// ---- Helpers ----
function num(n, p = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: p, maximumFractionDigits: p });
}

function signed(n, p = 2) {
  if (!Number.isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + num(n, p);
}

/** A rounded text-pill (rectText) anchored at the right edge of the chart. */
function pillRight(xRight, y, text, color, bg, opts = {}) {
  return {
    type: "rectText",
    ignoreEvent: true,
    attrs: {
      x: xRight - 6,
      y,
      text,
      align: "right",
      baseline: "middle",
    },
    styles: {
      color,
      backgroundColor: bg,
      borderColor: bg,
      borderRadius: 4,
      paddingLeft: 6,
      paddingRight: 6,
      paddingTop: 3,
      paddingBottom: 3,
      size: 11,
      weight: opts.bold ? "bold" : "normal",
    },
  };
}

/** A pill anchored at the LEFT of the entry zone — used for the LONG/SHORT badge. */
function pillLeft(xLeft, y, text, color, bg, opts = {}) {
  return {
    type: "rectText",
    ignoreEvent: true,
    attrs: {
      x: xLeft + 4,
      y,
      text,
      align: "left",
      baseline: opts.baseline ?? "middle",
    },
    styles: {
      color,
      backgroundColor: bg,
      borderColor: bg,
      borderRadius: 4,
      paddingLeft: 6,
      paddingRight: 6,
      paddingTop: 3,
      paddingBottom: 3,
      size: opts.size ?? 11,
      weight: opts.bold ? "bold" : "normal",
    },
  };
}

function makeTemplate(name, sideLabel) {
  const sideColor = sideLabel === "LONG" ? PROFIT : LOSS;

  return {
    name,
    totalStep: 4, // 3 clicks (entry, SL, TP) + finalised state
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,

    createPointFigures: ({ coordinates, bounding, overlay }) => {
      if (coordinates.length < 3) return [];
      const [entry, sl, tp] = coordinates;
      const entryPrice = overlay.points[0]?.value ?? 0;
      const slPrice = overlay.points[1]?.value ?? 0;
      const tpPrice = overlay.points[2]?.value ?? 0;

      const xLeft = entry.x;
      const xRight = bounding.width;
      const rectW = Math.max(0, xRight - xLeft);

      const profitTop = Math.min(entry.y, tp.y);
      const profitH = Math.abs(entry.y - tp.y);
      const lossTop = Math.min(entry.y, sl.y);
      const lossH = Math.abs(entry.y - sl.y);

      const profitPct = entryPrice ? ((tpPrice - entryPrice) / entryPrice) * 100 : 0;
      const lossPct = entryPrice ? ((slPrice - entryPrice) / entryPrice) * 100 : 0;
      const risk = Math.abs(entryPrice - slPrice);
      const reward = Math.abs(tpPrice - entryPrice);
      const rr = risk > 0 ? reward / risk : 0;

      return [
        // --- Filled zones (visual only) ---
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

        // --- Horizontal lines (these carry the drag hit-test) ---
        {
          type: "line",
          attrs: { coordinates: [{ x: xLeft, y: entry.y }, { x: xRight, y: entry.y }] },
          styles: { color: ENTRY, size: 1, style: "dashed", dashedValue: [4, 3] },
        },
        {
          type: "line",
          attrs: { coordinates: [{ x: xLeft, y: tp.y }, { x: xRight, y: tp.y }] },
          styles: { color: PROFIT, size: 1.5 },
        },
        {
          type: "line",
          attrs: { coordinates: [{ x: xLeft, y: sl.y }, { x: xRight, y: sl.y }] },
          styles: { color: LOSS, size: 1.5 },
        },

        // --- Side badge near entry (top-left of the zone) ---
        pillLeft(xLeft, entry.y - 14, sideLabel, TEXT_ON_COLOR, sideColor, {
          bold: true,
          size: 10,
        }),
        // R:R right under the side badge, same x.
        pillLeft(xLeft, entry.y + 14, `R:R ${num(rr)}`, NEUTRAL_TEXT, NEUTRAL_BG, {
          bold: true,
          size: 11,
        }),

        // --- Right-edge price pills, one per level ---
        pillRight(xRight, tp.y, `TP ${num(tpPrice)}  ${signed(profitPct)}%`, TEXT_ON_COLOR, PROFIT, { bold: true }),
        pillRight(xRight, entry.y, `Entry ${num(entryPrice)}`, NEUTRAL_TEXT, NEUTRAL_BG),
        pillRight(xRight, sl.y, `SL ${num(slPrice)}  ${signed(lossPct)}%`, TEXT_ON_COLOR, LOSS, { bold: true }),
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
