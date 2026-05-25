import { registerIndicator } from "klinecharts";

// A custom KLineChart indicator that paints stacked higher-timeframe candle groups
// in the right margin of the price pane (inspired by ICT HTF Candles). HTF data is
// supplied via the indicator's `extendData` as { groups: [{ htf, candles:[{t,o,h,l,c}] }] }.

export const HTF_INDICATOR = "ICT_HTF";

const UP = "#26a69a";
const DOWN = "#ef5350";
const LABEL = "#8b949e";
const DIVIDER = "#3b434d";

const BODY_W = 7; // candle body width (px)
const GAP = 3; // gap between candles within a group
const GROUP_GAP = 22; // gap between HTF groups
const PAD = 26; // gap from the live candles to the panel

/** Estimated px width the panel needs, used to reserve right-offset space. */
export function htfPanelWidth(groupCount, candlesPerGroup) {
  if (!groupCount) return 0;
  const groupW = candlesPerGroup * BODY_W + Math.max(0, candlesPerGroup - 1) * GAP;
  return PAD + groupCount * (groupW + GROUP_GAP) + 12;
}

let registered = false;
export function registerHtfIndicator() {
  if (registered) return;
  registered = true;
  registerIndicator({
    name: HTF_INDICATOR,
    shortName: "HTF",
    figures: [],
    calc: () => [],
    draw: ({ ctx, kLineDataList, indicator, bounding, xAxis, yAxis }) => {
      const ext = indicator.extendData;
      if (!ext || !ext.groups || !ext.groups.length || !kLineDataList.length) return true;

      const lastX = xAxis.convertToPixel(kLineDataList.length - 1);
      let x = lastX + PAD;

      ctx.save();
      // Divider between live price action and the HTF panel.
      ctx.strokeStyle = DIVIDER;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lastX + PAD / 2, 0);
      ctx.lineTo(lastX + PAD / 2, bounding.height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      for (const g of ext.groups) {
        const cs = g.candles || [];
        const groupW = cs.length * BODY_W + Math.max(0, cs.length - 1) * GAP;

        ctx.fillStyle = LABEL;
        ctx.fillText(String(g.htf).toUpperCase(), x + groupW / 2, 2);

        cs.forEach((c, i) => {
          const cx = x + i * (BODY_W + GAP) + BODY_W / 2;
          const color = c.c >= c.o ? UP : DOWN;
          const yH = yAxis.convertToPixel(c.h);
          const yL = yAxis.convertToPixel(c.l);
          const yO = yAxis.convertToPixel(c.o);
          const yC = yAxis.convertToPixel(c.c);

          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx, yH);
          ctx.lineTo(cx, yL);
          ctx.stroke();

          ctx.fillStyle = color;
          const top = Math.min(yO, yC);
          const h = Math.max(1, Math.abs(yC - yO));
          ctx.fillRect(cx - BODY_W / 2, top, BODY_W, h);
        });

        x += groupW + GROUP_GAP;
      }
      ctx.restore();
      return true;
    },
  });
}
