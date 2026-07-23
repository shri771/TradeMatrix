import { registerIndicator } from "klinecharts";

// ICT "Change in State of Delivery" (CISD).
//
// The market is "delivering" in one direction while it prints a run of
// consecutive same-direction candles (all up-close, or all down-close). Delivery
// has CHANGED once price closes back through the OPEN of the first candle of that
// run:
//   • a down-run (bearish delivery) whose origin open is reclaimed by an
//     up-close  → bullish CISD  (drawn green at that open level)
//   • an up-run (bullish delivery) whose origin open is broken by a down-close
//     → bearish CISD (drawn red at that open level)
//
// We only mark a line when the state actually FLIPS from the previous one (bull
// after bear, or bear after bull) — that's what "change in state" means, and it
// keeps the chart to one line per genuine shift instead of one per pullback.

export const CISD_INDICATOR = "ICT_CISD";

const BULL = "#26a69a";
const BEAR = "#ef5350";
const EXTEND_BARS = 5; // how far right of the confirmation the level line runs
const MAX_RUN = 100;   // cap the backward run scan (runs are short in practice)

const dir = (c) => (c.close > c.open ? 1 : c.close < c.open ? -1 : 0);

let registered = false;
export function registerCisdIndicator() {
  if (registered) return;
  registered = true;
  registerIndicator({
    name: CISD_INDICATOR,
    shortName: "CISD",
    figures: [],
    calc: () => [],
    draw: ({ ctx, kLineDataList, visibleRange, barSpace, xAxis, yAxis }) => {
      const data = kLineDataList;
      if (!Array.isArray(data) || data.length < 2) return true;

      const from = Math.max(1, visibleRange?.from ?? 1);
      const to = Math.min(data.length, (visibleRange?.to ?? data.length) + 1);
      const halfBar = ((barSpace?.bar ?? barSpace?.gapBar ?? 6) || 6) / 2;

      // Walk from the start so the "previous state" is always correct, but only
      // collect events that could touch the visible window (their level line
      // extends EXTEND_BARS to the right of the confirmation).
      let lastState = 0; // 1 = bullish delivery, -1 = bearish, 0 = unknown
      const events = [];
      for (let i = 1; i < to; i++) {
        const prev = data[i - 1];
        const cur = data[i];
        if (!prev || !cur) continue;
        const d = dir(prev);
        if (d === 0) continue;

        // Origin of the consecutive same-direction run ending at i-1.
        let s = i - 1;
        let steps = 0;
        while (s - 1 >= 0 && dir(data[s - 1]) === d && steps < MAX_RUN) {
          s--;
          steps++;
        }
        const level = data[s].open;

        let newState = 0;
        if (d < 0 && cur.close > level) newState = 1;       // reclaimed a down-run
        else if (d > 0 && cur.close < level) newState = -1; // broke an up-run
        if (newState === 0 || newState === lastState) continue;

        lastState = newState;
        if (i + EXTEND_BARS >= from) events.push({ s, i, level, bull: newState === 1 });
      }

      ctx.save();
      ctx.font = "10px sans-serif";
      for (const e of events) {
        const color = e.bull ? BULL : BEAR;
        const xL = xAxis.convertToPixel(e.s) - halfBar;
        const xR = xAxis.convertToPixel(Math.min(data.length - 1, e.i + EXTEND_BARS)) + halfBar;
        const y = yAxis.convertToPixel(e.level);

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(xL, y);
        ctx.lineTo(xR, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Small direction marker + label at the confirmation candle.
        const xC = xAxis.convertToPixel(e.i);
        ctx.fillStyle = color;
        ctx.beginPath();
        if (e.bull) {
          ctx.moveTo(xC, y - 9);
          ctx.lineTo(xC - 4, y - 2);
          ctx.lineTo(xC + 4, y - 2);
        } else {
          ctx.moveTo(xC, y + 9);
          ctx.lineTo(xC - 4, y + 2);
          ctx.lineTo(xC + 4, y + 2);
        }
        ctx.closePath();
        ctx.fill();

        ctx.textAlign = "left";
        ctx.textBaseline = e.bull ? "bottom" : "top";
        ctx.fillText("CISD", xR + 2, y);
      }
      ctx.restore();
      return true;
    },
  });
}
