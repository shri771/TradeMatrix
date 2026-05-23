from __future__ import annotations

import asyncio
from typing import AsyncIterator

import yfinance as yf

from models import Candle
from sources.base import DataSource

# yfinance interval -> (history period to request, poll cadence in seconds).
# Intraday history is limited by Yahoo (e.g. 1m only ~7 days), so periods are conservative.
_INTERVAL_CFG = {
    "1m": ("5d", 5),
    "5m": ("1mo", 15),
    "15m": ("1mo", 30),
    "30m": ("3mo", 60),
    "60m": ("6mo", 120),
    "1d": ("2y", 300),
}


def _df_to_candles(df) -> list[Candle]:
    candles: list[Candle] = []
    for ts, row in df.iterrows():
        candles.append(
            Candle(
                time=int(ts.timestamp()),
                open=float(row["Open"]),
                high=float(row["High"]),
                low=float(row["Low"]),
                close=float(row["Close"]),
                volume=float(row.get("Volume", 0.0) or 0.0),
            )
        )
    return candles


class YFinanceSource(DataSource):
    name = "yfinance"
    intervals = list(_INTERVAL_CFG.keys())

    def list_symbols(self) -> list[str]:
        # NSE symbols use the .NS suffix; ^NSEI is the NIFTY 50 index.
        return ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "SBIN.NS", "^NSEI"]

    def _search(self, query: str) -> list[dict]:
        results = yf.Search(query, max_results=25).quotes
        out: list[dict] = []
        for q in results:
            sym = q.get("symbol")
            if not sym:
                continue
            name = q.get("shortname") or q.get("longname") or sym
            exch = q.get("exchange", "")
            out.append({"symbol": sym, "name": f"{name} ({exch})" if exch else name})
        return out

    async def search_symbols(self, query: str) -> list[dict]:
        if not query:
            return [{"symbol": s, "name": s} for s in self.list_symbols()]
        try:
            return await asyncio.to_thread(self._search, query)
        except Exception:
            return []

    def _fetch(self, symbol: str, interval: str, limit: int) -> list[Candle]:
        period, _ = _INTERVAL_CFG.get(interval, ("5d", 5))
        df = yf.Ticker(symbol).history(period=period, interval=interval)
        if df.empty:
            return []
        candles = _df_to_candles(df)
        return candles[-limit:]

    async def get_candles(self, symbol: str, interval: str, limit: int = 500) -> list[Candle]:
        return await asyncio.to_thread(self._fetch, symbol, interval, limit)

    async def stream(self, symbol: str, interval: str) -> AsyncIterator[Candle]:
        _, poll_secs = _INTERVAL_CFG.get(interval, ("5d", 5))
        while True:
            try:
                candles = await asyncio.to_thread(self._fetch, symbol, interval, 2)
                if candles:
                    yield candles[-1]
            except Exception:
                pass  # transient Yahoo error; retry next poll
            await asyncio.sleep(poll_secs)
