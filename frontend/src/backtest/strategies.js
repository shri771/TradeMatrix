// Strategy library for the backtester. Each strategy's `signal(candles, params)`
// returns an array (one per bar) of TARGET positions: 1 (long), -1 (short), 0 (flat),
// or null during warm-up. The engine acts on the previous bar's target at the next
// bar's open, so there is no look-ahead.

function sma(arr, p) {
  const out = Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= p) sum -= arr[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

function ema(arr, p) {
  const out = Array(arr.length).fill(null);
  const k = 2 / (p + 1);
  let prev;
  for (let i = 0; i < arr.length; i++) {
    prev = i === 0 ? arr[i] : arr[i] * k + prev * (1 - k);
    if (i >= p - 1) out[i] = prev;
  }
  return out;
}

function rsi(arr, p) {
  const out = Array(arr.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < arr.length; i++) {
    const ch = arr[i] - arr[i - 1];
    const g = Math.max(0, ch);
    const l = Math.max(0, -ch);
    if (i <= p) {
      gain += g;
      loss += l;
      if (i === p) {
        gain /= p;
        loss /= p;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
    } else {
      gain = (gain * (p - 1) + g) / p;
      loss = (loss * (p - 1) + l) / p;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

const closesOf = (c) => c.map((x) => x.close);

export const STRATEGIES = {
  smaCross: {
    label: "SMA crossover",
    allowShort: true,
    params: [
      { key: "fast", label: "Fast", default: 10, min: 2 },
      { key: "slow", label: "Slow", default: 30, min: 3 },
    ],
    signal: (candles, p) => {
      const closes = closesOf(candles);
      const f = sma(closes, p.fast);
      const s = sma(closes, p.slow);
      return closes.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] > s[i] ? 1 : -1));
    },
  },

  emaCross: {
    label: "EMA crossover",
    allowShort: true,
    params: [
      { key: "fast", label: "Fast", default: 12, min: 2 },
      { key: "slow", label: "Slow", default: 26, min: 3 },
    ],
    signal: (candles, p) => {
      const closes = closesOf(candles);
      const f = ema(closes, p.fast);
      const s = ema(closes, p.slow);
      return closes.map((_, i) => (f[i] == null || s[i] == null ? null : f[i] > s[i] ? 1 : -1));
    },
  },

  rsi: {
    label: "RSI mean-reversion",
    allowShort: false,
    params: [
      { key: "period", label: "Period", default: 14, min: 2 },
      { key: "oversold", label: "Buy <", default: 30, min: 1 },
      { key: "overbought", label: "Exit >", default: 60, min: 1 },
    ],
    signal: (candles, p) => {
      const r = rsi(closesOf(candles), p.period);
      const out = [];
      let cur = 0;
      for (let i = 0; i < r.length; i++) {
        if (r[i] == null) {
          out.push(null);
          continue;
        }
        if (r[i] < p.oversold) cur = 1;
        else if (r[i] > p.overbought) cur = 0;
        out.push(cur);
      }
      return out;
    },
  },

  breakout: {
    label: "Donchian breakout",
    allowShort: false,
    params: [{ key: "lookback", label: "Lookback", default: 20, min: 2 }],
    signal: (candles, p) => {
      const out = [];
      let cur = 0;
      const n = p.lookback;
      for (let i = 0; i < candles.length; i++) {
        if (i < n) {
          out.push(null);
          continue;
        }
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = i - n; j < i; j++) {
          if (candles[j].high > hh) hh = candles[j].high;
          if (candles[j].low < ll) ll = candles[j].low;
        }
        if (candles[i].close > hh) cur = 1;
        else if (candles[i].close < ll) cur = 0;
        out.push(cur);
      }
      return out;
    },
  },
};
