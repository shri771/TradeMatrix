#!/usr/bin/env bash
# Serve the whole app from ONE port: FastAPI mounts the built SPA at / while
# keeping /api and /ws, so the browser talks to a single origin (no Vite proxy,
# no CORS). This is the same single-image mode the Dockerfile uses.
#
# Deliberately NOT the Vite dev server: Vite 5.4.12+ validates the Host header
# (`server.allowedHosts`) and rejects a *.app.github.dev URL outright.
set -euo pipefail
cd "$(dirname "$0")/.."

# Build on first run if setup.sh hasn't produced dist/ yet.
if [ ! -f frontend/dist/index.html ]; then
  echo "==> No build found; running setup first"
  bash .devcontainer/setup.sh
fi

export FRONTEND_DIST="$PWD/frontend/dist"

# Local secrets, if present (.env is gitignored). In Codespaces prefer a
# Codespaces secret named DATABENTO_API_KEY — it arrives as a real env var and
# this block is skipped.
if [ -f .env ] && [ -z "${DATABENTO_API_KEY:-}" ]; then
  set -a; . ./.env; set +a
fi

if [ -z "${DATABENTO_API_KEY:-}" ]; then
  echo "WARN: DATABENTO_API_KEY unset — futures (NQ/ES/YM/GC/...) will return no candles."
  echo "      Hyperliquid (crypto) and yfinance (stocks) still work."
fi

# NixOS only: pip's numpy/pandas wheels need libstdc++ on LD_LIBRARY_PATH. A
# no-op in the codespace (Debian), where /nix/store doesn't exist.
if [ -d /nix/store ]; then
  LIBS=""
  for lib in libstdc++.so.6 libz.so.1; do
    found="$(find /nix/store -name "$lib" 2>/dev/null | sort | tail -1 || true)"
    [ -n "$found" ] && LIBS="${LIBS:+$LIBS:}$(dirname "$found")"
  done
  [ -n "$LIBS" ] && export LD_LIBRARY_PATH="${LIBS}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

cd backend
echo "==> Serving TradeMatrix on :${PORT:-1030}"
exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port "${PORT:-1030}"
