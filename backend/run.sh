#!/usr/bin/env bash
# Launches the TradeMatrix backend. On NixOS, pip's binary wheels (numpy/pandas)
# need libstdc++ on LD_LIBRARY_PATH; we locate it automatically if present.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi

LIBS=""
for lib in libstdc++.so.6 libz.so.1; do
  found="$(find /nix/store -name "$lib" 2>/dev/null | sort | tail -1 || true)"
  [ -n "$found" ] && LIBS="${LIBS:+$LIBS:}$(dirname "$found")"
done
if [ -n "$LIBS" ]; then
  export LD_LIBRARY_PATH="${LIBS}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

exec .venv/bin/uvicorn main:app --reload --port 8080
