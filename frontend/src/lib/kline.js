// Map a backend Candle (time in seconds) to KLineChart's format (timestamp in ms).
export const toKline = (c) => ({
  timestamp: c.time * 1000,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
  volume: c.volume,
});

// Approx seconds per canonical interval (shared by replay clock + data window sizing).
export const INTERVAL_SECONDS = {
  "1m": 60,
  "3m": 180,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};
