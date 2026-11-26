#!/usr/bin/env bash
# Startet PostgreSQL 16 und Redis lokal ohne Docker (für Entwicklung/Tests in Umgebungen ohne Docker-Daemon).
# Nutzung: scripts/local-services.sh start|stop|status
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.local"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGPORT="${PGPORT:-54329}"
REDISPORT="${REDISPORT:-63799}"
mkdir -p "$DIR"
# PostgreSQL verweigert den Start als root → als Benutzer „postgres“ ausführen.
AS=()
if [ "$(id -u)" = "0" ]; then
  AS=(runuser -u postgres --)
  mkdir -p "$DIR/pg"; chown postgres "$DIR" "$DIR/pg"
fi

start() {
  if [ ! -f "$DIR/pg/PG_VERSION" ]; then
    "${AS[@]}" "$PGBIN/initdb" -D "$DIR/pg" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
  fi
  if ! "${AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/pg" status >/dev/null 2>&1; then
    "${AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/pg" -l "$DIR/pg.log" -o "-p $PGPORT -k $DIR -c listen_addresses=127.0.0.1" start >/dev/null
  fi
  if ! redis-cli -p "$REDISPORT" ping >/dev/null 2>&1; then
    redis-server --port "$REDISPORT" --daemonize yes --dir "$DIR" --logfile "$DIR/redis.log" --save "" >/dev/null
  fi
  echo "PostgreSQL: 127.0.0.1:$PGPORT · Redis: 127.0.0.1:$REDISPORT"
}
stop() {
  "${AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/pg" stop >/dev/null 2>&1 || true
  redis-cli -p "$REDISPORT" shutdown nosave >/dev/null 2>&1 || true
}
status() {
  "${AS[@]}" "$PGBIN/pg_ctl" -D "$DIR/pg" status || true
  redis-cli -p "$REDISPORT" ping || true
}
"${1:-start}"
