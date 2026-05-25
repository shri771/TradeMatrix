from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncIterator

from models import Candle


class DataSource(ABC):
    """Contract every broker/data provider implements.

    To add a new source (Alpaca, Binance, Zerodha, Polygon, ...): subclass this,
    implement the three methods, and register one instance in data_source.py.
    """

    name: str
    intervals: list[str]

    @abstractmethod
    def list_symbols(self) -> list[str]:
        """A short curated list shown as default suggestions before the user searches."""

    async def search_symbols(self, query: str) -> list[dict]:
        """Return [{symbol, name}] matching `query`. Empty query -> default suggestions.

        Default implementation filters list_symbols(); sources with a full universe
        (Hyperliquid) or a search API (yfinance) override this.
        """
        syms = self.list_symbols()
        if not query:
            return [{"symbol": s, "name": s} for s in syms]
        q = query.lower()
        return [{"symbol": s, "name": s} for s in syms if q in s.lower()]

    @abstractmethod
    async def get_candles(
        self, symbol: str, interval: str, limit: int = 500, end: int | None = None
    ) -> list[Candle]:
        """Historical candles, oldest-first. `end` (unix seconds) returns the `limit`
        bars ending at/just before that time (used by replay to start from a past date);
        omitted means the most recent bars."""

    @abstractmethod
    async def stream(self, symbol: str, interval: str) -> AsyncIterator[Candle]:
        """Yield live candle updates. The latest (current) candle may be re-emitted as it forms."""
        raise NotImplementedError
        yield  # pragma: no cover  (marks this as an async generator)
