// Event-driven backtest over a candle array. The strategy emits a target position
// per bar (1/-1/0/null); we act on the PREVIOUS bar's target at the current bar's
// OPEN (no look-ahead), size positions all-in on current equity, and charge a fee
// (basis points of notional) on every fill. Returns trades, an equity curve, and stats.

export function runBacktest(candles, signal, { capital = 100000, feeBps = 5, allowShort = false } = {}) {
  const targets = signal(candles);
  const feeRate = feeBps / 10000;

  let cash = capital;
  let qty = 0; // signed
  let side = 0; // -1, 0, 1
  let entryPrice = 0;
  let entryTime = 0;
  const trades = [];
  const equityCurve = [];

  const recordTrade = (exitPrice, exitTime) => {
    const pnl = (exitPrice - entryPrice) * qty; // qty signed -> correct for long & short
    const cost = entryPrice * Math.abs(qty);
    trades.push({
      side,
      entryTime,
      entryPrice,
      exitTime,
      exitPrice,
      qty: Math.abs(qty),
      pnl,
      pnlPct: cost ? (pnl / cost) * 100 : 0,
    });
  };

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    let desired = i > 0 ? targets[i - 1] ?? side : side;
    if (!allowShort && desired < 0) desired = 0;

    if (desired !== side) {
      const px = bar.open;
      if (side !== 0) {
        cash += qty * px; // close: long sells (+), short covers (qty<0 -> -)
        cash -= Math.abs(qty) * px * feeRate;
        recordTrade(px, bar.time);
        qty = 0;
      }
      if (desired !== 0) {
        const newQty = (cash / px) * desired; // all-in, signed
        cash -= newQty * px;
        cash -= Math.abs(newQty) * px * feeRate;
        qty = newQty;
        entryPrice = px;
        entryTime = bar.time;
      }
      side = desired;
    }

    equityCurve.push({ time: bar.time, equity: cash + qty * bar.close });
  }

  // Close any open position at the final close.
  if (side !== 0 && candles.length) {
    const last = candles[candles.length - 1];
    cash += qty * last.close;
    cash -= Math.abs(qty) * last.close * feeRate;
    recordTrade(last.close, last.time);
    qty = 0;
    side = 0;
    if (equityCurve.length) equityCurve[equityCurve.length - 1] = { time: last.time, equity: cash };
  }

  return { trades, equityCurve, stats: computeStats(trades, equityCurve, capital) };
}

function computeStats(trades, equityCurve, capital) {
  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : capital;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  let peak = -Infinity;
  let maxDD = 0;
  for (const e of equityCurve) {
    if (e.equity > peak) peak = e.equity;
    if (peak > 0) maxDD = Math.max(maxDD, (peak - e.equity) / peak);
  }

  return {
    finalEquity,
    totalReturnPct: ((finalEquity - capital) / capital) * 100,
    numTrades: trades.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: maxDD * 100,
  };
}
