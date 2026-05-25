import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";

const TradingContext = createContext(null);
export const START_CASH = 100000;
const ACCOUNT_KEY = "tm:account";

function loadAccount() {
  try {
    const a = JSON.parse(localStorage.getItem(ACCOUNT_KEY));
    if (a && typeof a.cash === "number") return a;
  } catch {}
  return null;
}

/**
 * A simulated paper-trading account shared across panes. Positions net long/short
 * with realized P&L folded into cash; unrealized P&L and equity are marked against
 * the latest price each pane reports (live tick or replay candle).
 */
export function TradingProvider({ children }) {
  // Account state survives reloads (positions/trades/realized/cash); the equity curve
  // and live price marks rebuild on their own from incoming prices.
  const [cash, setCash] = useState(() => loadAccount()?.cash ?? START_CASH);
  const [positions, setPositions] = useState(() => loadAccount()?.positions ?? {});
  const [trades, setTrades] = useState(() => loadAccount()?.trades ?? []);
  const [realized, setRealized] = useState(() => loadAccount()?.realized ?? 0);
  const [prices, setPrices] = useState({}); // symbol -> { price, time }
  const [equityCurve, setEquityCurve] = useState([]);

  useEffect(() => {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ cash, positions, trades, realized }));
  }, [cash, positions, trades, realized]);

  const posRef = useRef(positions);
  useEffect(() => {
    posRef.current = positions;
  }, [positions]);

  const reportPrice = useCallback((symbol, price, time) => {
    if (price == null) return;
    setPrices((prev) => {
      const cur = prev[symbol];
      if (cur && cur.price === price && cur.time === time) return prev;
      return { ...prev, [symbol]: { price, time } };
    });
  }, []);

  const fill = useCallback((symbol, side, qty, price, time) => {
    qty = Number(qty);
    if (!qty || qty <= 0 || price == null) return;
    const signed = side === "buy" ? qty : -qty;

    // Compute the new position from the current ref (no nested setState), then set
    // each piece of state exactly once.
    const prev = posRef.current;
    const pos = prev[symbol] || { qty: 0, avg: 0 };
    let pq = pos.qty;
    let avg = pos.avg;
    let realizedDelta = 0;

    if (pq === 0 || Math.sign(pq) === Math.sign(signed)) {
      const nq = pq + signed; // adding to / opening position
      avg = (Math.abs(pq) * avg + Math.abs(signed) * price) / Math.abs(nq);
      pq = nq;
    } else {
      const closing = Math.min(Math.abs(signed), Math.abs(pq));
      realizedDelta = closing * (price - avg) * Math.sign(pq); // P&L on closed portion
      const remaining = Math.abs(signed) - closing;
      pq = pq + signed;
      if (Math.abs(pq) < 1e-9) {
        pq = 0;
        avg = 0;
      } else if (remaining > 0) {
        avg = price; // flipped direction
      }
    }

    const next = { ...prev };
    if (pq === 0) delete next[symbol];
    else next[symbol] = { qty: pq, avg };
    posRef.current = next; // keep ref current for back-to-back fills (e.g. closePosition)

    setPositions(next);
    if (realizedDelta) setRealized((r) => r + realizedDelta);
    setCash((c) => c - signed * price);
    setTrades((t) => [...t, { id: `${Date.now()}-${Math.random()}`, symbol, side, qty, price, time }]);
  }, []);

  const closePosition = useCallback(
    (symbol, price, time) => {
      const pos = posRef.current[symbol];
      if (!pos || !pos.qty) return;
      fill(symbol, pos.qty > 0 ? "sell" : "buy", Math.abs(pos.qty), price, time);
    },
    [fill]
  );

  const reset = useCallback(() => {
    setCash(START_CASH);
    setPositions({});
    setTrades([]);
    setRealized(0);
    setEquityCurve([]);
  }, []);

  // Sample equity whenever marks change.
  useEffect(() => {
    const pos = posRef.current;
    const eq =
      cash +
      Object.entries(pos).reduce(
        (s, [sym, p]) => s + p.qty * (prices[sym]?.price ?? p.avg),
        0
      );
    const t = Math.max(0, ...Object.values(prices).map((p) => p.time || 0));
    setEquityCurve((c) => {
      const last = c[c.length - 1];
      if (last && last.time === t) {
        const cp = c.slice();
        cp[cp.length - 1] = { time: t, equity: eq };
        return cp;
      }
      const nc = [...c, { time: t, equity: eq }];
      return nc.length > 600 ? nc.slice(-600) : nc;
    });
  }, [prices, cash]);

  const { equity, unrealized } = useMemo(() => {
    let mv = 0;
    let upnl = 0;
    for (const [sym, p] of Object.entries(positions)) {
      const mark = prices[sym]?.price ?? p.avg;
      mv += p.qty * mark;
      upnl += p.qty * (mark - p.avg);
    }
    return { equity: cash + mv, unrealized: upnl };
  }, [positions, prices, cash]);

  const value = {
    cash,
    positions,
    prices,
    trades,
    realized,
    equityCurve,
    equity,
    unrealized,
    fill,
    closePosition,
    reportPrice,
    reset,
  };

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}

export function useTrading() {
  const ctx = useContext(TradingContext);
  if (!ctx) throw new Error("useTrading must be used within TradingProvider");
  return ctx;
}
