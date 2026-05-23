from __future__ import annotations

import asyncio

from sources.base import DataSource
from sources.hyperliquid import HyperliquidSource
from sources.yfinance_source import YFinanceSource

# The single plug point. Add a new broker by implementing DataSource in sources/
# and adding one line here.
REGISTRY: dict[str, DataSource] = {
    "hyperliquid": HyperliquidSource(),
    "yfinance": YFinanceSource(),
}


def get_source(name: str) -> DataSource:
    if name not in REGISTRY:
        raise KeyError(f"unknown data source: {name!r}")
    return REGISTRY[name]


def list_sources() -> list[dict]:
    return [
        {"name": s.name, "symbols": s.list_symbols(), "intervals": s.intervals}
        for s in REGISTRY.values()
    ]


async def search_all(query: str) -> list[dict]:
    """Search every registered source concurrently and merge, tagging each result
    with its source so the UI can offer one search box across all of them."""

    async def one(src: DataSource) -> list[dict]:
        try:
            results = await src.search_symbols(query)
        except Exception:
            return []
        for r in results:
            r["source"] = src.name
        return results

    groups = await asyncio.gather(*(one(s) for s in REGISTRY.values()))
    merged: list[dict] = []
    for group in groups:
        merged.extend(group)
    return merged
