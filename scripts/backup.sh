#!/usr/bin/env bash
# Tägliches Backup für den Docker-Compose-Betrieb (Homeserver): Datenbank + Dateiablage, verschlüsselt.
#
#   BACKUP_PASSPHRASE=… scripts/backup.sh            # z. B. per cron täglich 03:30
#
# Umgebungsvariablen (aus .env oder der Umgebung):
#   ENV_FILE            Standard .env
#   BACKUP_PASSPHRASE   Pflicht. Passphrase für die Verschlüsselung (gut aufbewahren – ohne sie keine Wiederherstellung)
#   BACKUP_DIR          Ziel, Standard ./backups (besser: Laufwerk/NAS außer Haus, z. B. per rclone danach kopieren)
#   BACKUP_KEEP_DAYS    Aufbewahrung in Tagen, Standard 30
#   DB_NAME             Standard schulungsnachweis
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"
# Einzelne Werte aus der .env lesen (nicht „sourcen“: Werte wie MAIL_FROM=Name <a@b> sind kein gültiges Shell)
envval() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }
for v in BACKUP_PASSPHRASE BACKUP_DIR BACKUP_KEEP_DAYS DB_NAME; do
  [ -z "${!v:-}" ] && val="$(envval "$v")" && [ -n "$val" ] && export "$v=$val"
done
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE setzen}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
KEEP="${BACKUP_KEEP_DAYS:-30}"
DB="${DB_NAME:-schulungsnachweis}"
COMPOSE=(docker compose -f infra/docker-compose.yml --env-file "$ENV_FILE")
PROJECT="$("${COMPOSE[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$BACKUP_DIR"
umask 077

enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE; }

echo "Datenbank sichern …"
"${COMPOSE[@]}" exec -T postgres pg_dump -U postgres -Fc "$DB" | enc > "$BACKUP_DIR/db_$STAMP.dump.enc"
"${COMPOSE[@]}" exec -T postgres pg_dumpall -U postgres --globals-only | enc > "$BACKUP_DIR/roles_$STAMP.sql.enc"

echo "Dateiablage sichern …"
docker run --rm -v "${PROJECT}_storage:/data:ro" alpine:3.20 tar -C /data -czf - . | enc > "$BACKUP_DIR/files_$STAMP.tar.gz.enc"

# Prüfsummen für die Wiederherstellungsprobe
( cd "$BACKUP_DIR" && sha256sum ./*_"$STAMP".* > "SHA256SUMS_$STAMP" )

echo "Alte Sicherungen (> $KEEP Tage) entfernen …"
find "$BACKUP_DIR" -maxdepth 1 -type f -mtime +"$KEEP" -name '*_*' -delete

echo "Fertig: $BACKUP_DIR (*_$STAMP.*)"
