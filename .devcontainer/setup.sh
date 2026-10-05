#!/usr/bin/env bash
# One-time codespace setup: Python deps + a production build of the SPA.
# Re-runnable; `start.sh` calls nothing from here, so run this again by hand after
# changing requirements.txt or package.json.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing backend dependencies"
cd backend
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
cd ..

echo "==> Building the frontend"
cd frontend
npm install --no-audit --no-fund
npm run build
cd ..

echo "==> Setup complete. Run .devcontainer/start.sh to serve."
