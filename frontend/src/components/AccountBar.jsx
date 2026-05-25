import React from "react";
import { useTrading, START_CASH } from "../trading/TradingProvider";

const money = (n, d = 0) =>
  (n < 0 ? "-" : "") +
  "$" +
  Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

function Sparkline({ data }) {
  if (data.length < 2) return <svg className="acct-spark" width="120" height="22" />;
  const vals = data.map((d) => d.equity);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const W = 120;
  const H = 22;
  const pts = vals
    .map((v, i) => `${(i / (vals.length - 1)) * W},${H - ((v - min) / span) * (H - 2) - 1}`)
    .join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg className="acct-spark" width={W} height={H}>
      <polyline points={pts} fill="none" stroke={up ? "#26a69a" : "#ef5350"} strokeWidth="1.5" />
    </svg>
  );
}

/** Toolbar summary of the paper-trading account. */
export default function AccountBar() {
  const { equity, realized, unrealized, equityCurve, reset } = useTrading();
  const totalPnl = realized + unrealized;
  const ret = ((equity - START_CASH) / START_CASH) * 100;

  return (
    <div className="account-bar">
      <Sparkline data={equityCurve} />
      <div className="acct-fig">
        <span className="acct-label">Equity</span>
        <span className="acct-val">{money(equity)}</span>
      </div>
      <div className="acct-fig">
        <span className="acct-label">P&amp;L</span>
        <span className={`acct-val ${totalPnl >= 0 ? "up" : "down"}`}>
          {totalPnl >= 0 ? "+" : ""}{money(totalPnl, 2)} ({ret >= 0 ? "+" : ""}{ret.toFixed(2)}%)
        </span>
      </div>
      <button className="rb-btn" title="Reset account" onClick={reset}>↺</button>
    </div>
  );
}
