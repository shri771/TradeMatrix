from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass
class Candle:
    """A single OHLCV bar. `time` is a UNIX timestamp in seconds (Lightweight Charts convention)."""

    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)
