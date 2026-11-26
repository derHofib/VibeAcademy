#!/usr/bin/env bash
# Wiederherstellung aus scripts/backup.sh. ACHTUNG: überschreibt Datenbank und Dateiablage.
#
#   BACKUP_PASSPHRASE=… scripts/restore.sh backups 2026-11-26_0330
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
DIR="${1:?Backup-Verzeichnis angeben}"; STAMP="${2:?Zeitstempel angeben, z. B. 2026-11-26_0330}"
DB="${DB_NAME:-schulungsnachweis}"
COMPOSE=(docker compose -f infra/docker-compose.yml --env-file "$ENV_FILE")
PROJECT="$("${COMPOSE[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
dec() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE; }

( cd "$DIR" && sha256sum -c "SHA256SUMS_$STAMP" )
read -r -p "Datenbank \"$DB\" und Dateiablage jetzt überschreiben? (ja/nein) " ok; [ "$ok" = "ja" ] || exit 1

"${COMPOSE[@]}" stop api caddy
dec < "$DIR/roles_$STAMP.sql.enc" | "${COMPOSE[@]}" exec -T postgres psql -U postgres -q >/dev/null 2>&1 || true
"${COMPOSE[@]}" exec -T postgres dropdb -U postgres --if-exists --force "$DB"
"${COMPOSE[@]}" exec -T postgres createdb -U postgres -O app_migrator "$DB"
dec < "$DIR/db_$STAMP.dump.enc" | "${COMPOSE[@]}" exec -T postgres pg_restore -U postgres -d "$DB" --exit-on-error  # Eigentümer beibehalten: SECURITY-DEFINER-Funktionen gehören app_definer
dec < "$DIR/files_$STAMP.tar.gz.enc" | docker run --rm -i -v "${PROJECT}_storage:/data" alpine:3.20 sh -c 'rm -rf /data/* && tar -C /data -xzf -'
"${COMPOSE[@]}" up -d
echo "Wiederhergestellt aus $STAMP."
