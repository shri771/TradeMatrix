import { registerIndicator } from "klinecharts";

// ICT "Precision Swing Point" (PSP) marker indicator.
//
// The divergence is computed in ChartPane (needs the correlated instrument's
// candles) and handed in via the indicator's `extendData` as:
//   { byTime: { [timestampSec]: { direction: "bullish"|"bearish", labels: string[] } } }
//
// For each flagged candle we outline the bar and drop a triangle just outside it:
//   • bearish PSP (pivot high) → red,  down-triangle ABOVE the high
//   • bullish PSP (pivot low)  → teal, up-triangle  BELOW the low
// A sparse "PSP vs ES/YM" label is drawn at the freshest markers only, so a
// cluster of pivots doesn't turn into a wall of text.

export const PSP_INDICATOR = "ICT_PSP";

const BULL = "#26a69a";
const BEAR = "#ef5350";
const LABEL_MIN_GAP = 40; // px between labels — clutter control

let registered = false;
export function registerPspIndicator() {
  if (registered) return;
  registered = true;
  registerIndicator({
    name: PSP_INDICATOR,
    shortName: "PSP",
    figures: [],
    calc: () => [],
    draw: ({ ctx, kLineDataList, indicator, visibleRange, barSpace, xAxis, yAxis }) => {
      const data = kLineDataList;
      if (!Array.isArray(data) || !data.length) return true;
      const byTime = indicator?.extendData?.byTime;
      if (!byTime) return true;

      const from = Math.max(0, visibleRange?.from ?? 0);
      const to = Math.min(data.length, (visibleRange?.to ?? data.length) + 1);
      const halfBar = (((barSpace?.bar ?? barSpace?.gapBar ?? 6) || 6) / 2);

      ctx.save();
      ctx.font = "bold 9px sans-serif";
      let lastLabelX = -Infinity;

      for (let i = from; i < to; i++) {
        const c = data[i];
        if (!c) continue;
        const t = Math.floor((c.timestamp ?? 0) / 1000);
        const mark = byTime[t];
        if (!mark) continue;

        const bull = mark.direction === "bullish";
        const color = bull ? BULL : BEAR;
        const x = xAxis.convertToPixel(i);
        const yHigh = yAxis.convertToPixel(c.high);
        const yLow = yAxis.convertToPixel(c.low);

        // Outline the diverging bar so it stands out from its neighbours.
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.85;
        ctx.strokeRect(x - halfBar, yHigh, halfBar * 2, Math.max(1, yLow - yHigh));
        ctx.globalAlpha = 1;

        // Triangle marker just outside the pivot, pointing the trade direction.
        ctx.fillStyle = color;
        ctx.beginPath();
        if (bull) {
          const y = yLow + 11; // below the low, pointing up
          ctx.moveTo(x, y - 8);
          ctx.lineTo(x - 4, y);
          ctx.lineTo(x + 4, y);
        } else {
          const y = yHigh - 11; // above the high, pointing down
          ctx.moveTo(x, y + 8);
          ctx.lineTo(x - 4, y);
          ctx.lineTo(x + 4, y);
        }
        ctx.closePath();
        ctx.fill();

        // Sparse label naming the diverging correlate(s).
        if (x - lastLabelX >= LABEL_MIN_GAP) {
          lastLabelX = x;
          const text = mark.labels && mark.labels.length
            ? `PSP vs ${mark.labels.join("/")}`
            : "PSP";
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          if (bull) {
            ctx.textBaseline = "top";
            ctx.fillText(text, x, yLow + 14);
          } else {
            ctx.textBaseline = "bottom";
            ctx.fillText(text, x, yHigh - 14);
          }
        }
      }

      ctx.restore();
      return true;
    },
  });
}
