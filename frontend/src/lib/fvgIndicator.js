import { registerIndicator } from "klinecharts";

// ICT Fair Value Gap (FVG) — a 3-candle imbalance. Given candles c0, c1, c2:
//   • Bullish FVG: c2.low > c0.high  → an unfilled gap [c0.high, c2.low]
//   • Bearish FVG: c2.high < c0.low  → an unfilled gap [c2.high, c0.low]
// c1 is the big middle candle whose fast move left the gap the market often
// returns to "fill". We shade each gap and extend the box a couple of candles
// to the right so it's easy to see where price may rebalance.

export const FVG_INDICATOR = "ICT_FVG";

// How many candles past the 3-candle pattern the box runs. Kept short (per the
// trader's ask: "till 2 candles") so the chart stays readable.
const EXTEND_BARS = 2;

const BULL_FILL = "rgba(38, 166, 154, 0.16)";
const BEAR_FILL = "rgba(239, 83, 80, 0.16)";
const BULL_EDGE = "rgba(38, 166, 154, 0.55)";
const BEAR_EDGE = "rgba(239, 83, 80, 0.55)";

let registered = false;
export function registerFvgIndicator() {
  if (registered) return;
  registered = true;
  registerIndicator({
    name: FVG_INDICATOR,
    shortName: "FVG",
    figures: [],
    calc: () => [],
    draw: ({ ctx, kLineDataList, visibleRange, barSpace, xAxis, yAxis }) => {
      const data = kLineDataList;
      if (!Array.isArray(data) || data.length < 3) return true;

      // Only scan what's on screen (plus a small margin) — cheap and keeps the
      // box count sane. Fall back to the whole list if visibleRange is absent.
      const from = Math.max(2, (visibleRange?.from ?? 2) - EXTEND_BARS);
      const to = Math.min(data.length, (visibleRange?.to ?? data.length) + 1);
      const halfBar = ((barSpace?.bar ?? barSpace?.gapBar ?? 6) || 6) / 2;

      ctx.save();
      for (let i = from; i < to; i++) {
        const c0 = data[i - 2];
        const c2 = data[i];
        if (!c0 || !c2) continue;

        let lo;
        let hi;
        let fill;
        let edge;
        if (c2.low > c0.high) {
          lo = c0.high;
          hi = c2.low;
          fill = BULL_FILL;
          edge = BULL_EDGE;
        } else if (c2.high < c0.low) {
          lo = c2.high;
          hi = c0.low;
          fill = BEAR_FILL;
          edge = BEAR_EDGE;
        } else {
          continue;
        }

        // Box spans the gap price band, from the middle candle out EXTEND_BARS
        // candles past the 3rd. Left/right nudged half a bar so it hugs candles.
        const xLeft = xAxis.convertToPixel(i - 1) - halfBar;
        const xRight = xAxis.convertToPixel(i + EXTEND_BARS) + halfBar;
        const yTop = yAxis.convertToPixel(hi);
        const yBot = yAxis.convertToPixel(lo);
        const top = Math.min(yTop, yBot);
        const h = Math.max(1, Math.abs(yBot - yTop));
        const w = Math.max(1, xRight - xLeft);

        ctx.fillStyle = fill;
        ctx.fillRect(xLeft, top, w, h);
        ctx.strokeStyle = edge;
        ctx.lineWidth = 1;
        ctx.strokeRect(xLeft, top, w, h);
      }
      ctx.restore();
      return true;
    },
  });
}
