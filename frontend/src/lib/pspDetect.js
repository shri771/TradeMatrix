// PSP (Precision Swing Point) detection.
//
// Concept (ICT / Quarterly Theory): two closely-correlated assets (NQ / ES / YM
// index futures) normally deliver in the same direction candle-for-candle. A
// *Precision Swing Point* is a SWING candle — a 3-bar pivot high or low — whose
// close DISAGREES across the correlated pair: one instrument closes bullish
// while the other closes bearish on that same bar. That opposite-close at a
// pivot flags a precise, likely reversal.
//
// It's the candle-level cousin of SMT (see smtDetect.js): SMT compares the
// *prices* of two adjacent swings, PSP compares the *closes* of a single swing
// candle. We reuse SMT's swing finder so both indicators agree on what a swing is.
//
// Direction follows the pivot type, matching ICT usage:
//   • pivot HIGH + opposite close → bearish PSP (potential top)
//   • pivot LOW  + opposite close → bullish PSP (potential bottom)

import { findSwings } from "./smtDetect";

const dir = (c) => (c.close > c.open ? 1 : c.close < c.open ? -1 : 0);

/**
 * @param {Array<{time:number,open:number,high:number,low:number,close:number}>} mainCandles
 *        the pane's instrument, ascending by time (seconds).
 * @param {Array<{label:string, candles:Array<{time:number,open:number,close:number}>}>} correlates
 *        the correlated instruments to compare each swing candle against.
 * @returns {Array<{time:number, price:number, direction:"bullish"|"bearish", labels:string[]}>}
 *          one entry per swing candle whose close diverges from >= 1 correlate.
 *          `price` is the pivot extreme (high for bearish, low for bullish);
 *          `labels` names the correlate(s) it diverged from (e.g. ["ES","YM"]).
 */
export function detectPsp(mainCandles, correlates) {
  if (!Array.isArray(mainCandles) || mainCandles.length < 3) return [];
  const cors = (correlates || []).filter(
    (c) => c && Array.isArray(c.candles) && c.candles.length
  );
  if (!cors.length) return [];

  // Each correlate's candle DIRECTION indexed by timestamp, for O(1) alignment
  // of the same bar across instruments (all series share the interval, so a
  // matching `time` is the same bar).
  const corMaps = cors.map((c) => {
    const m = new Map();
    for (const k of c.candles) m.set(k.time, dir(k));
    return { label: c.label, dir: m };
  });

  // Main instrument's own close-direction, indexed by timestamp.
  const mainDir = new Map();
  for (const c of mainCandles) mainDir.set(c.time, dir(c));

  const { highs, lows } = findSwings(mainCandles);
  const out = [];

  const scan = (pivots, kind) => {
    for (const p of pivots) {
      const md = mainDir.get(p.time);
      if (!md) continue; // doji pivot — no clear delivery to diverge from
      const labels = [];
      for (const cm of corMaps) {
        const cd = cm.dir.get(p.time);
        if (cd == null || cd === 0) continue; // correlate absent/doji on this bar
        if (cd !== md) labels.push(cm.label); // opposite close ⇒ PSP vs this correlate
      }
      if (labels.length) {
        out.push({
          time: p.time,
          price: p.price,
          direction: kind === "highs" ? "bearish" : "bullish",
          labels,
        });
      }
    }
  };

  scan(highs, "highs");
  scan(lows, "lows");
  out.sort((a, b) => a.time - b.time);
  return out;
}
