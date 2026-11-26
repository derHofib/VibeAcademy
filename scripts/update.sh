#!/usr/bin/env bash
# Update auf dem Server: neuesten Stand holen, neu bauen, starten (Migrationen laufen automatisch).
#   scripts/update.sh            (vorher: scripts/backup.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml --env-file .env ps
