#!/usr/bin/env bash
# Lokale Entwicklung ohne Docker: Postgres/Redis starten, migrieren, API (Port 3000) und Web (Port 5173) starten.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
scripts/local-services.sh start
[ -f .env ] || { echo ".env fehlt – cp .env.example .env und Secrets setzen"; exit 1; }
pnpm --filter @sn/shared --filter @sn/db build >/dev/null
pnpm --filter @sn/db run bootstrap >/dev/null && pnpm db:migrate
pnpm --filter @sn/api build >/dev/null
(cd apps/api && node dist/main.js) &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
pnpm --filter @sn/web dev --host 127.0.0.1
