import { registerOverlay } from "klinecharts";
import { correctOverlayX } from "./overlayTimeCtx";

// "Date & price range" measurement tool, modelled on TradingView's tool of the
// same name. Two clicks define opposite corners of a box; the box reports how far
// price moved between the corners (absolute + %) and how much time / how many bars
// it spans. Purely a measuring aid — it carries no trading semantics like the
// position tool does.

// ---- Theme ----
const FILL = "rgba(41, 98, 255, 0.10)"; // faint blue wash, like a selection
const BORDER = "#2962ff";               // klinecharts overlay blue
const UP = "#26a69a";                   // price rose across the range
const DOWN = "#ef5350";                 // price fell across the range
const FLAT = "#aeb6c2";
const LABEL_BG = "rgba(20, 26, 33, 0.92)";
const LABEL_TEXT = "#e6edf3";

// Overlay IDs currently selected — drives the per-overlay delete pill, same
// mechanism as the position/fibonacci tools. Cross-pane deletes flow through the
// "tm:delete-overlay" DOM event that ChartPane listens for.
const selectedIds = new Set();

function num(n, p = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: p, maximumFractionDigits: p });
}
function signed(n, p = 2) {
  if (!Number.isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + num(n, p);
}

// Compact human duration: minutes → hours → days → months, dropping zero tails.
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60), m = mins % 60;
  if (hrs < 24) return m ? `${hrs}h ${m}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24), h = hrs % 24;
  if (days < 30) return h ? `${days}d ${h}h` : `${days}d`;
  const mos = Math.floor(days / 30), d = days % 30;
  return d ? `${mos}mo ${d}d` : `${mos}mo`;
}

// A centered text pill.
function centerPill(x, y, text, color) {
  return {
    type: "text",
    ignoreEvent: true,
    attrs: { x, y, text, align: "center", baseline: "middle" },
    styles: {
      color,
      backgroundColor: LABEL_BG,
      borderColor: LABEL_BG,
      borderRadius: 3,
      paddingLeft: 6,
      paddingRight: 6,
      paddingTop: 3,
      paddingBottom: 3,
      size: 11,
      weight: "normal",
    },
  };
}

let registered = false;
export function registerDatePriceRangeOverlay() {
  if (registered) return;
  registered = true;
  registerOverlay({
    name: "datePriceRange",
    totalStep: 3, // click 1 (a corner) + click 2 (opposite corner) + finalised
    needDefaultPointFigure: true, // draggable corner handles + selection
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,

    onSelected: ({ overlay }) => { selectedIds.add(overlay.id); return false; },
    onDeselected: ({ overlay }) => { selectedIds.delete(overlay.id); return false; },
    onRemoved: ({ overlay }) => { selectedIds.delete(overlay.id); return false; },
    onClick: ({ figureKey, overlay }) => {
      if (figureKey === "delete") {
        try { window.dispatchEvent(new CustomEvent("tm:delete-overlay", { detail: overlay.id })); } catch {}
        return true;
      }
      return false;
    },

    createPointFigures: ({ coordinates, overlay, barSpace }) => {
      if (coordinates.length < 2) return [];
      // Re-project x from each anchor's true timestamp so the box (and its bar
      // count) stay put across timeframe switches — same fix the other time-anchored
      // tools use. See lib/overlayTimeCtx.
      const [p1, p2] = correctOverlayX(overlay, coordinates, barSpace);

      const xLeft = Math.min(p1.x, p2.x);
      const xRight = Math.max(p1.x, p2.x);
      const yTop = Math.min(p1.y, p2.y);
      const yBottom = Math.max(p1.y, p2.y);
      const w = Math.max(0, xRight - xLeft);
      const h = Math.max(0, yBottom - yTop);

      // --- Measurements ---
      // Price: signed change from the FIRST click to the second, and its %.
      const price1 = overlay.points[0]?.value ?? 0;
      const price2 = overlay.points[1]?.value ?? 0;
      const dPrice = price2 - price1;
      const dPct = price1 ? (dPrice / price1) * 100 : 0;
      const dir = dPrice > 0 ? UP : dPrice < 0 ? DOWN : FLAT;

      // Bars: derived from the on-screen span, not the stored dataIndex — this stays
      // correct after a timeframe switch and is gap-aware (markets that don't trade
      // 24/7 have fewer bars than wall-clock hours). barSpace is {bar, ...}.
      const barPx = typeof barSpace === "number" ? barSpace : barSpace?.bar;
      const t1 = overlay.points[0]?.timestamp;
      const t2 = overlay.points[1]?.timestamp;
      const bars = barPx ? Math.round(Math.abs(p2.x - p1.x) / barPx) : "—";
      const dur = fmtDuration(Number.isFinite(t1) && Number.isFinite(t2) ? Math.abs(t2 - t1) : NaN);

      const cx = (xLeft + xRight) / 2;
      const cy = (yTop + yBottom) / 2;

      const showDelete = selectedIds.has(overlay.id);
      const deleteFig = showDelete ? [{
        type: "text",
        key: "delete",
        attrs: { x: xRight - 6, y: yTop - 14, text: "×", align: "right", baseline: "middle" },
        styles: {
          color: "#ffffff", backgroundColor: "#ef5350", borderColor: "#ef5350",
          borderRadius: 10, paddingLeft: 7, paddingRight: 7, paddingTop: 2, paddingBottom: 2,
          size: 13, weight: "bold",
        },
      }] : [];

      return [
        ...deleteFig,
        // The measurement box (stroke + faint fill). Not ignoreEvent, so the user
        // can grab it to move the whole range.
        {
          type: "rect",
          attrs: { x: xLeft, y: yTop, width: w, height: h },
          styles: {
            style: "stroke_fill",
            color: FILL,
            borderColor: BORDER,
            borderSize: 1,
            borderStyle: "dashed",
            borderDashedValue: [4, 4],
          },
        },
        // Price change + % (coloured by direction) stacked over bars + duration.
        centerPill(cx, cy - 9, `${signed(dPrice)} (${signed(dPct)}%)`, dir),
        centerPill(cx, cy + 9, `${bars} bars · ${dur}`, LABEL_TEXT),
      ];
    },
  });
}
