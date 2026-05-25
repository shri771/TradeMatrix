from __future__ import annotations

import json
import time
from typing import AsyncIterator

import httpx
import websockets

from models import Candle
from sources.base import DataSource

WS_URL = "wss://api.hyperliquid.xyz/ws"
INFO_URL = "https://api.hyperliquid.xyz/info"

# Hyperliquid candle intervals -> milliseconds (for history window sizing).
_INTERVAL_MS = {
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "8h": 28_800_000,
    "12h": 43_200_000,
    "1d": 86_400_000,
}


def _to_candle(raw: dict) -> Candle:
    return Candle(
        time=int(raw["t"]) // 1000,
        open=float(raw["o"]),
        high=float(raw["h"]),
        low=float(raw["l"]),
        close=float(raw["c"]),
        volume=float(raw.get("v", 0.0)),
    )


class HyperliquidSource(DataSource):
    name = "hyperliquid"
    # Canonical timeframe set shared across all sources (identical UI everywhere).
    intervals = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"]

    def __init__(self):
        self._universe: list[str] | None = None

    def list_symbols(self) -> list[str]:
        return ["BTC", "ETH", "SOL", "HYPE", "ARB", "AVAX", "DOGE", "LINK"]

    async def _load_universe(self) -> list[str]:
        if self._universe is None:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(INFO_URL, json={"type": "meta"})
                resp.raise_for_status()
                data = resp.json()
            self._universe = [a["name"] for a in data.get("universe", [])]
        return self._universe

    async def search_symbols(self, query: str) -> list[dict]:
        if not query:
            return [{"symbol": s, "name": s} for s in self.list_symbols()]
        universe = await self._load_universe()
        q = query.upper()
        matches = [s for s in universe if q in s.upper()]
        matches.sort(key=lambda s: (not s.upper().startswith(q), s))
        return [{"symbol": s, "name": f"{s}-PERP"} for s in matches[:50]]

    async def get_candles(
        self, symbol: str, interval: str, limit: int = 500, end: int | None = None
    ) -> list[Candle]:
        step = _INTERVAL_MS.get(interval, 60_000)
        end_ms = int(time.time() * 1000) if end is None else end * 1000
        start_ms = end_ms - step * limit
        payload = {
            "type": "candleSnapshot",
            "req": {"coin": symbol, "interval": interval, "startTime": start_ms, "endTime": end_ms},
        }
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(INFO_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
        return [_to_candle(c) for c in data][-limit:]

    async def stream(self, symbol: str, interval: str) -> AsyncIterator[Candle]:
        sub = {
            "method": "subscribe",
            "subscription": {"type": "candle", "coin": symbol, "interval": interval},
        }
        async for ws in websockets.connect(WS_URL, ping_interval=20):
            try:
                await ws.send(json.dumps(sub))
                async for message in ws:
                    msg = json.loads(message)
                    if msg.get("channel") == "candle":
                        yield _to_candle(msg["data"])
            except websockets.ConnectionClosed:
                continue  # reconnect via the async-for-ws loop
