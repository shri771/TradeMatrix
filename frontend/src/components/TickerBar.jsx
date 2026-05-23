import React, { useEffect, useRef, useState } from "react";

/** Shows the latest price and flashes green/red on every change. */
export default function TickerBar({ price }) {
  const prevRef = useRef(null);
  const [dir, setDir] = useState(null); // "up" | "down" | null
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (price == null) return;
    const prev = prevRef.current;
    if (prev != null && price !== prev) {
      setDir(price > prev ? "up" : "down");
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 200);
      prevRef.current = price;
      return () => clearTimeout(t);
    }
    prevRef.current = price;
  }, [price]);

  if (price == null) return <span className="ticker">—</span>;

  const cls = ["ticker", dir, flash ? `flash-${dir}` : ""].filter(Boolean).join(" ");
  const decimals = price >= 100 ? 2 : price >= 1 ? 3 : 5;
  return <span className={cls}>{price.toFixed(decimals)}</span>;
}
