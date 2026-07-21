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
const HTF_COUNT_MIN = 6; // keep group columns a stable width even for short data
const BAND_TOP_PAD = 20; // px below the HTF label before candles start
const BAND_BOT_PAD = 26; // px above the bottom (leaves room for SMT badges)
const BAND_HEIGHT_FRAC = 0.5; // HTF candles fill this fraction of the pane — compact, ~main-chart size

// SMT (Smart Money Technique) divergence colours.
const SMT_DIVERGE = "#f0b90b"; // amber — bull/bear disagreement between correlated assets
const SMT_TEXT = "#0e1117";
const BADGE_H = 14;
const BADGE_GAP = 3;

/** Estimated px width the panel needs, used to reserve right-offset space. */
export function htfPanelWidth(groupCount, candlesPerGroup) {
  if (!groupCount) return 0;
  const groupW = Math.max(
    candlesPerGroup * BODY_W + Math.max(0, candlesPerGroup - 1) * GAP,
    68 // room for two ~30-wide SMT badges + gap when SMT is enabled
  );
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
      const groups = ext && ext.groups ? ext.groups : [];

      // Anchor the HTF panel to the RIGHT edge of the chart (not to the last
      // data point's pixel) so it stays visible when the user scrolls back and
      // remains inside the bounds even before setOffsetRightDistance has been
      // called. This is what the ICT-style TradingView indicators do.
      const panelW = htfPanelWidth(groups.length || 1, HTF_COUNT_MIN);
      const panelLeft = Math.max(0, bounding.width - panelW);
      let x = panelLeft + PAD;

      ctx.save();
      // Divider between live price action and the HTF panel.
      ctx.strokeStyle = DIVIDER;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(panelLeft + PAD / 2, 0);
      ctx.lineTo(panelLeft + PAD / 2, bounding.height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      // Loading / empty state: makes the panel visibly present even before the
      // async fetch completes or if all fetches failed. Also confirms visually
      // that the indicator itself is registered and drawing.
      if (!groups.length || !kLineDataList.length) {
        ctx.fillStyle = LABEL;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("HTF …", panelLeft + PAD, bounding.height / 2);
        ctx.restore();
        return true;
      }

      // Vertical band the HTF candles live in. Each group is SELF-SCALED to its
      // own high/low and mapped into this band, so the candles render at a
      // compact, consistent size — the same visual footprint as the main chart —
      // instead of inheriting the main price axis (which made a 1D candle, whose
      // range dwarfs the intraday window, tower off the top/bottom). The main
      // chart's own scale is left untouched.
      //
      // The band is a modest slice of the pane centred on the CURRENT price
      // (last main close) so the panels sit beside the live price action rather
      // than filling the whole height. Clamped to stay fully on-screen.
      const usableTop = BAND_TOP_PAD;
      const usableBot = Math.max(usableTop + 20, bounding.height - BAND_BOT_PAD);
      const bandH = (usableBot - usableTop) * BAND_HEIGHT_FRAC;
      const lastClose = kLineDataList[kLineDataList.length - 1]?.close;
      const anchorY =
        typeof lastClose === "number" && yAxis ? yAxis.convertToPixel(lastClose) : (usableTop + usableBot) / 2;
      let bandTop = anchorY - bandH / 2;
      if (bandTop < usableTop) bandTop = usableTop;
      let bandBot = bandTop + bandH;
      if (bandBot > usableBot) {
        bandBot = usableBot;
        bandTop = bandBot - bandH;
      }

      for (const g of groups) {
        const cs = g.candles || [];
        const groupW = Math.max(cs.length, HTF_COUNT_MIN) * BODY_W +
          Math.max(0, Math.max(cs.length, HTF_COUNT_MIN) - 1) * GAP;

        ctx.fillStyle = LABEL;
        ctx.textBaseline = "top";
        ctx.fillText(String(g.htf).toUpperCase(), x + groupW / 2, 2);

        // Per-group price -> pixel: fit this group's [low, high] into the band
        // (low at the bottom, high at the top). Flat group -> centered line.
        let lo = Infinity;
        let hi = -Infinity;
        for (const c of cs) {
          if (c.l < lo) lo = c.l;
          if (c.h > hi) hi = c.h;
        }
        const span = hi - lo;
        const yOf = (p) => (span > 0 ? bandBot - ((p - lo) / span) * bandH : (bandTop + bandBot) / 2);

        cs.forEach((c, i) => {
          const cx = x + i * (BODY_W + GAP) + BODY_W / 2;
          const color = c.c >= c.o ? UP : DOWN;
          const yH = yOf(c.h);
          const yL = yOf(c.l);
          const yO = yOf(c.o);
          const yC = yOf(c.c);

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

        // SMT: badges for correlated assets under this HTF group. Each badge shows
        // the correlated symbol's short code + directional colour; amber outline if
        // it diverges from the main symbol's last-candle direction.
        if (g.correlates && g.correlates.length && cs.length) {
          const mainLast = cs[cs.length - 1];
          const mainDir = mainLast.c >= mainLast.o ? "up" : "down";
          const badgeW = Math.max(30, Math.floor(groupW / g.correlates.length) - BADGE_GAP);
          const badgeY = bounding.height - BADGE_H - 4;
          ctx.textBaseline = "middle";
          ctx.font = "9px sans-serif";
          g.correlates.forEach((cor, i) => {
            const bx = x + i * (badgeW + BADGE_GAP);
            const diverges = cor.dir !== mainDir;
            const bg = cor.dir === "up" ? UP : DOWN;
            // Filled coloured pill
            ctx.fillStyle = bg;
            roundRect(ctx, bx, badgeY, badgeW, BADGE_H, 3, true, false);
            // Amber outline on divergence
            if (diverges) {
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = SMT_DIVERGE;
              roundRect(ctx, bx - 0.5, badgeY - 0.5, badgeW + 1, BADGE_H + 1, 3.5, false, true);
            }
            // Text: "ES ▲" or "YM ▼"
            const arrow = cor.dir === "up" ? "▲" : "▼";
            ctx.fillStyle = SMT_TEXT;
            ctx.fillText(`${cor.label ?? cor.symbol} ${arrow}`, bx + badgeW / 2, badgeY + BADGE_H / 2);
          });
        }

        x += groupW + GROUP_GAP;
      }
      ctx.restore();
      return true;
    },
  });
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}
