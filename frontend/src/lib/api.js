export async function fetchSources() {
  const res = await fetch("/api/sources");
  if (!res.ok) throw new Error("failed to load sources");
  return res.json();
}

export async function fetchCandles(source, symbol, interval, limit = 500) {
  const params = new URLSearchParams({ source, symbol, interval, limit });
  const res = await fetch(`/api/candles?${params}`);
  if (!res.ok) throw new Error(`failed to load candles: ${res.status}`);
  return res.json();
}

// Omit `source` to search across all sources at once.
export async function searchSymbols(query, source) {
  const params = new URLSearchParams({ query });
  if (source) params.set("source", source);
  const res = await fetch(`/api/search?${params}`);
  if (!res.ok) throw new Error("search failed");
  return res.json();
}
