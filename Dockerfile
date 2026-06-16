# --- Stage 1: build the React frontend into static assets ---
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Stage 2: FastAPI backend that also serves the built frontend ---
FROM python:3.12-slim
WORKDIR /app/backend

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
# Built SPA goes where main.py looks for it (./static next to main.py).
COPY --from=frontend /app/frontend/dist ./static

# Cloud Run injects $PORT (default 8080). Shell form lets us substitute it.
# Secrets (DATABENTO_API_KEY) are NOT baked in — they're injected at runtime via
# `gcloud run deploy --set-secrets DATABENTO_API_KEY=databento-api-key:latest`.
EXPOSE 8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
