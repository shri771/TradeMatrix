from __future__ import annotations

import asyncio
import datetime
import logging
import os
from typing import AsyncIterator

import databento as db
import pandas as pd

from models import Candle
from sources.base import DataSource

_log = logging.getLogger("databento_source")
_log.setLevel(logging.INFO)

# Minimum lookback for intraday windows. Futures sessions span weekends/holidays
# (a Memorial Day weekend = ~72h of no trading), so a tight window can legitimately
# return zero bars. 14d guarantees we catch the most recent session for any limit.
_INTRADAY_MIN_WINDOW = 14 * 86400

# Canonical interval -> (Databento native OHLCV schema, resample rule | None, seconds).
# Databento's native OHLCV schemas are 1m / 1h / 1d only; everything else resamples.
_INTERVAL_CFG = {
    "1m":  ("ohlcv-1m", None,    60),
    "3m":  ("ohlcv-1m", "3min",  180),
    "5m":  ("ohlcv-1m", "5min",  300),
    "15m": ("ohlcv-1m", "15min", 900),
    "30m": ("ohlcv-1m", "30min", 1800),
    "1h":  ("ohlcv-1h", None,    3600),
    "4h":  ("ohlcv-1h", "4h",    14400),
    "1d":  ("ohlcv-1d", None,    86400),
}

# Continuous front-month CME futures via `stype_in="continuous"` (equivalent to
# TradingView's NQ1! / ES1! / GC1! notation).
_SYMBOLS = [
    {"symbol": "NQ.c.0",  "name": "E-mini Nasdaq-100 (NQ1!)"},
    {"symbol": "ES.c.0",  "name": "E-mini S&P 500 (ES1!)"},
    {"symbol": "YM.c.0",  "name": "E-mini Dow (YM1!)"},
    {"symbol": "RTY.c.0", "name": "E-mini Russell 2000 (RTY1!)"},
    {"symbol": "GC.c.0",  "name": "Gold (GC1!)"},
    {"symbol": "SI.c.0",  "name": "Silver (SI1!)"},
    {"symbol": "CL.c.0",  "name": "Crude oil (CL1!)"},
    {"symbol": "HG.c.0",  "name": "Copper (HG1!)"},
    {"symbol": "NG.c.0",  "name": "Natural gas (NG1!)"},
]


class DatabentoSource(DataSource):
    name = "databento"
    intervals = list(_INTERVAL_CFG.keys())

    def __init__(self) -> None:
        key = os.environ.get("DATABENTO_API_KEY")
        self._client = db.Historical(key=key) if key else None
        # In-memory cache keyed by (symbol, schema, start_s, end_s) so the lazy-load
        # on scroll doesn't re-bill for the same window during a session.
        self._cache: dict[tuple[str, str, int, int], list[Candle]] = {}
        # Cache the dataset's available [start, end] per schema (refreshed every ~5 min).
        # Clamping both bounds prevents 422s when callers request a window that
        # extends past the available data on either side.
        self._dataset_range_cache: dict[str, tuple[float, int, int]] = {}

    def _dataset_range(self, schema: str) -> tuple[int, int]:
        import time
        now = time.time()
        cached = self._dataset_range_cache.get(schema)
        if cached and now - cached[0] < 300:
            return cached[1], cached[2]
        if self._client is None:
            return 0, int(now) - 86400
        try:
            info = self._client.metadata.get_dataset_range(dataset="GLBX.MDP3")
            sch = info.get("schema", {}).get(schema, {})
            start_str = sch.get("start") or info.get("start")
            end_str = sch.get("end") or info.get("end")
            start_s = int(datetime.datetime.fromisoformat(start_str.replace("Z", "+00:00")).timestamp())
            end_s = int(datetime.datetime.fromisoformat(end_str.replace("Z", "+00:00")).timestamp())
        except Exception:
            start_s, end_s = 0, int(now) - 86400
        self._dataset_range_cache[schema] = (now, start_s, end_s)
        return start_s, end_s

    def list_symbols(self) -> list[str]:
        return [s["symbol"] for s in _SYMBOLS]

    async def search_symbols(self, query: str) -> list[dict]:
        if not query:
            return [{"symbol": s["symbol"], "name": s["name"]} for s in _SYMBOLS]
        q = query.upper()
        return [
            {"symbol": s["symbol"], "name": s["name"]}
            for s in _SYMBOLS
            if q in s["symbol"].upper() or q in s["name"].upper()
        ]

    def _fetch_window(self, symbol: str, schema: str, start_s: int, end_s: int) -> list[Candle]:
        """Pull a (symbol, schema, [start, end]) window from Databento. Cached."""
        if self._client is None:
            return []
        # Clamp [start, end] to what the dataset actually has available so requesting
        # more history than exists returns whatever's there instead of 422-ing.
        available_start, available_end = self._dataset_range(schema)
        if end_s > available_end:
            end_s = available_end - 60
        if start_s < available_start:
            start_s = available_start
        if start_s >= end_s:
            return []
        key = (symbol, schema, start_s, end_s)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        try:
            start = datetime.datetime.fromtimestamp(start_s, datetime.timezone.utc)
            end = datetime.datetime.fromtimestamp(end_s, datetime.timezone.utc)
            data = self._client.timeseries.get_range(
                dataset="GLBX.MDP3",
                symbols=[symbol],
                schema=schema,
                start=start,
                end=end,
                stype_in="continuous",
            )
            df = data.to_df()
            if df.empty:
                return []
            candles = [
                Candle(
                    time=int(ts.timestamp()),
                    open=float(row["open"]),
                    high=float(row["high"]),
                    low=float(row["low"]),
                    close=float(row["close"]),
                    volume=float(row.get("volume", 0) or 0),
                )
                for ts, row in df.iterrows()
            ]
        except Exception as exc:
            _log.error(
                "Databento fetch failed: symbol=%s schema=%s window=[%s, %s] err=%s: %s",
                symbol, schema,
                datetime.datetime.fromtimestamp(start_s, datetime.timezone.utc).isoformat(),
                datetime.datetime.fromtimestamp(end_s, datetime.timezone.utc).isoformat(),
                type(exc).__name__, exc,
            )
            return []
        # Bounded cache (drop the oldest half when full — insertion-ordered).
        self._cache[key] = candles
        if len(self._cache) > 256:
            for k in list(self._cache.keys())[:128]:
                del self._cache[k]
        return candles

    async def get_candles(
        self, symbol: str, interval: str, limit: int = 500, end: int | None = None
    ) -> list[Candle]:
        cfg = _INTERVAL_CFG.get(interval)
        if cfg is None or self._client is None:
            return []
        schema, rule, sec = cfg
        if end is not None:
            end_s = end
        else:
            # Databento's historical feed lags real time by a few minutes; requesting
            # `end=now` triggers a 422 (data_end_after_available_end). 15-minute
            # clamp comfortably covers the observed lag for OHLCV on GLBX.MDP3.
            end_s = int(datetime.datetime.now(datetime.timezone.utc).timestamp()) - 900
        # Buffer for weekends/closed sessions + resampling slack.
        buffer = 1.6 if rule is None else 2.0
        wanted = int(sec * limit * buffer)
        # For intraday, ensure the window is wide enough to span any holiday weekend.
        window = max(wanted, _INTRADAY_MIN_WINDOW) if sec < 86400 else wanted + 86400
        start_s = end_s - window

        candles = await asyncio.to_thread(self._fetch_window, symbol, schema, start_s, end_s)

        if rule and candles:
            df = pd.DataFrame(
                [
                    {"t": c.time, "open": c.open, "high": c.high, "low": c.low, "close": c.close, "volume": c.volume}
                    for c in candles
                ]
            )
            df["t"] = pd.to_datetime(df["t"], unit="s", utc=True)
            df = df.set_index("t")
            agg = (
                df.resample(rule, label="left", closed="left")
                .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
                .dropna(subset=["open", "high", "low", "close"])
            )
            candles = [
                Candle(
                    time=int(ts.timestamp()),
                    open=float(r["open"]),
                    high=float(r["high"]),
                    low=float(r["low"]),
                    close=float(r["close"]),
                    volume=float(r["volume"]),
                )
                for ts, r in agg.iterrows()
            ]
        return candles[-limit:]

    async def stream(self, symbol: str, interval: str) -> AsyncIterator[Candle]:
        # Historical-only — no live ticks (saves trial credits). The WS pump just exits.
        return
        yield  # pragma: no cover (marks this as an async generator)
