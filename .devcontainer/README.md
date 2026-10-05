# Running TradeMatrix in GitHub Codespaces

This gives you **one public HTTPS link** that anyone can open — no hosting bill.
FastAPI serves the built SPA plus `/api` and `/ws` on a single port, so there is
one origin, one forwarded port, one link.

> **Codespaces is a dev environment, not a host.** The link only works while the
> codespace is *running*, and a codespace **stops after 30 minutes of inactivity**
> (nobody clicking in the editor — browser traffic to the forwarded port does not
> count as activity). See "Limits" at the bottom before relying on this.

## One-time setup

1. **Push this repo** (including `.devcontainer/`) to GitHub.

2. **Add the Databento key as a Codespaces secret** — skip if you don't need the
   futures symbols (NQ/ES/YM/GC/...); Hyperliquid crypto and yfinance stocks work
   without it.

   Repo → **Settings → Secrets and variables → Codespaces → New repository secret**
   - Name: `DATABENTO_API_KEY`
   - Value: your key

   It arrives in the container as a real env var, so nothing is ever committed.

3. **Create the codespace**: green **`<> Code`** button → **Codespaces** tab →
   **Create codespace on main**.

   First boot takes ~3-5 min: it installs Python deps, runs `npm install`, and
   builds the SPA (`.devcontainer/setup.sh`), then starts the server
   (`.devcontainer/start.sh`). Watch the terminal for:

   ```
   ==> Serving TradeMatrix on :1030
   ```

4. **Make the port public** — the one manual step, and the one that makes the link
   work for other people. Port visibility cannot be set from `devcontainer.json`.

   In the codespace: **Ports** panel (next to the terminal) → right-click row
   **1030** → **Port Visibility → Public**.

   Or from your own machine:
   ```bash
   gh codespace ports visibility 1030:public -c <codespace-name>   # gh codespace list
   ```

5. **Copy the link.** In the Ports panel the "Forwarded Address" is your public URL:

   ```
   https://<codespace-name>-1030.app.github.dev
   ```

   That name is fixed when the codespace is created, so the URL stays the same
   across stop/start. Share it — anyone with it can open the dashboard.

## Day-to-day

| Task | Command (in the codespace terminal) |
|---|---|
| Start the server | `bash .devcontainer/start.sh` |
| Rebuild after frontend changes | `cd frontend && npm run build` (then restart) |
| Reinstall deps | `bash .devcontainer/setup.sh` |

Frontend edits need a **rebuild** — this serves static files, not the Vite dev
server, so there is no hot reload. (That's deliberate: Vite 5.4.12+ validates the
`Host` header and rejects `*.app.github.dev` outright, so the dev server cannot
be shared this way without extra config.)

Backend edits: restart `start.sh`. Add `--reload` to the uvicorn line in
`start.sh` if you want auto-restart while developing.

## Limits — read before sharing the link

- **Stops after 30 min idle.** The link 404s/times out until you restart the
  codespace, and the server does not come back by itself — reattach, or run
  `start.sh` again (`postAttachCommand` runs it when you open the codespace).
  Raise the timeout at https://github.com/settings/codespaces → *Default idle
  timeout* (max 240 min).
- **Burns your free quota.** GitHub Free includes 120 core-hours/month; this
  config requests a 2-core machine, so ~60 wall-clock hours/month. Check
  https://github.com/settings/billing — once the quota is gone, codespaces either
  stop or start billing depending on your spending limit.
- **Deleted after 30 days** of inactivity by default, which destroys the URL.
- **A public port is genuinely public and unauthenticated.** Anyone with the link
  can call `/api/candles`, which spends *your* Databento credits. The startup
  prefetch alone fires ~27 Databento requests on every boot.
- **Org-owned repos** can forbid public port forwarding by policy; if the Public
  option is greyed out, that's why.

If you need a link that is actually always-on, this repo already builds a
single Cloud Run image (`Dockerfile` + `DEPLOY.md`) — Cloud Run's free tier
covers a low-traffic service and scales to zero. Fly.io and Hugging Face Spaces
also run this Dockerfile as-is on free tiers.
