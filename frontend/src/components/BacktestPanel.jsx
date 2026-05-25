import React, { useState } from "react";
import { fetchCandles } from "../lib/api";
import { STRATEGIES } from "../backtest/strategies";
import { runBacktest } from "../backtest/engine";

const BT_BARS = 1000;

function defaultParams(key) {
  return Object.fromEntries(STRATEGIES[key].params.map((p) => [p.key, p.default]));
}

function EquitySvg({ curve }) {
  if (curve.length < 2) return null;
  const vals = curve.map((d) => d.equity);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const W = 200;
  const H = 48;
  const pts = vals
    .map((v, i) => `${(i / (vals.length - 1)) * W},${H - ((v - min) / span) * (H - 4) - 2}`)
    .join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg className="bt-equity" width={W} height={H}>
      <polyline points={pts} fill="none" stroke={up ? "#26a69a" : "#ef5350"} strokeWidth="1.5" />
    </svg>
  );
}

const pct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

/** Run a built-in strategy over a window of the pane's instrument and show results. */
export default function BacktestPanel({ source, symbol, interval, onResult }) {
  const [key, setKey] = useState("smaCross");
  const [params, setParams] = useState(() => defaultParams("smaCross"));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const strat = STRATEGIES[key];

  const pickStrategy = (k) => {
    setKey(k);
    setParams(defaultParams(k));
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const cs = await fetchCandles(source, symbol, interval, BT_BARS);
      if (cs.length < 30) throw new Error("not enough history");
      const r = runBacktest(cs, (candles) => strat.signal(candles, params), {
        allowShort: strat.allowShort,
      });
      setResult(r);
      onResult?.(r);
    } catch (e) {
      setError(e.message || String(e));
      setResult(null);
      onResult?.(null);
    } finally {
      setRunning(false);
    }
  };

  const s = result?.stats;

  return (
    <div className="bt-panel">
      <select className="bt-select" value={key} onChange={(e) => pickStrategy(e.target.value)}>
        {Object.entries(STRATEGIES).map(([k, v]) => (
          <option key={k} value={k}>{v.label}</option>
        ))}
      </select>

      <div className="bt-params">
        {strat.params.map((p) => (
          <label key={p.key} className="bt-param">
            {p.label}
            <input
              type="number"
              min={p.min}
              value={params[p.key]}
              onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))}
            />
          </label>
        ))}
      </div>

      <button className="bt-run" onClick={run} disabled={running}>
        {running ? "Running…" : `Run on ${symbol} ${interval}`}
      </button>

      {error && <div className="bt-error">{error}</div>}

      {s && (
        <>
          <div className="bt-stats">
            <div className="bt-stat">
              <span>Return</span>
              <b className={s.totalReturnPct >= 0 ? "up" : "down"}>{pct(s.totalReturnPct)}</b>
            </div>
            <div className="bt-stat"><span>Win rate</span><b>{s.winRatePct.toFixed(0)}%</b></div>
            <div className="bt-stat"><span>Max DD</span><b className="down">-{s.maxDrawdownPct.toFixed(1)}%</b></div>
            <div className="bt-stat"><span>Trades</span><b>{s.numTrades}</b></div>
            <div className="bt-stat">
              <span>Profit factor</span>
              <b>{s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)}</b>
            </div>
          </div>
          <EquitySvg curve={result.equityCurve} />
        </>
      )}
    </div>
  );
}
