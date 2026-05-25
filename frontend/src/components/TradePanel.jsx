import React, { useState } from "react";
import { useTrading } from "../trading/TradingProvider";

const fmt = (n, d = 2) =>
  n == null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/** Per-pane paper-trading controls: buy/sell/flat at the pane's current price. */
export default function TradePanel({ symbol }) {
  const { positions, prices, fill, closePosition } = useTrading();
  const [qty, setQty] = useState(1);

  const mark = prices[symbol]?.price;
  const time = prices[symbol]?.time;
  const pos = positions[symbol];
  const uPnl = pos && mark != null ? pos.qty * (mark - pos.avg) : 0;

  const trade = (side) => {
    if (mark == null) return;
    fill(symbol, side, Number(qty), mark, time);
  };

  return (
    <div className="trade-panel">
      <div className="tp-row tp-mark">
        <span>{symbol}</span>
        <span>{fmt(mark)}</span>
      </div>
      <div className="tp-pos">
        {pos ? (
          <>
            <span className={pos.qty > 0 ? "up" : "down"}>
              {pos.qty > 0 ? "LONG" : "SHORT"} {fmt(Math.abs(pos.qty), 4)}
            </span>
            <span>@ {fmt(pos.avg)}</span>
            <span className={uPnl >= 0 ? "up" : "down"}>{uPnl >= 0 ? "+" : ""}{fmt(uPnl)}</span>
          </>
        ) : (
          <span className="tp-flat">no position</span>
        )}
      </div>
      <div className="tp-row">
        <input
          type="number"
          min="0"
          step="any"
          className="tp-qty"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </div>
      <div className="tp-row tp-actions">
        <button className="tp-buy" onClick={() => trade("buy")} disabled={mark == null}>Buy</button>
        <button className="tp-sell" onClick={() => trade("sell")} disabled={mark == null}>Sell</button>
        <button className="tp-flat-btn" onClick={() => closePosition(symbol, mark, time)} disabled={!pos}>
          Flat
        </button>
      </div>
    </div>
  );
}
