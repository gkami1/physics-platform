#!/usr/bin/env bash
# Nightly Postgres dump on the server (cron, see docs/DEPLOY.md). Keeps KEEP_DAYS days.
#
#   infra/backup.sh                       # dump to $BACKUP_DIR
#   infra/backup.sh --restore FILE.sql.gz # restore a dump (stops the API meanwhile)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/physics-platform}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/physics-platform}"
KEEP_DAYS="${KEEP_DAYS:-14}"
compose() { docker compose -f "$APP_DIR/infra/compose.yaml" "$@"; }

if [[ "${1:-}" == "--restore" ]]; then
  FILE="${2:?usage: infra/backup.sh --restore FILE.sql.gz}"
  echo "Restoring $FILE: this REPLACES the current database. Ctrl+C within 10 s to abort."
  sleep 10
  compose stop api
  compose exec -T db psql -q -U physics -d postgres \
    -c "DROP DATABASE IF EXISTS physics WITH (FORCE);" -c "CREATE DATABASE physics OWNER physics;"
  gunzip -c "$FILE" | compose exec -T db psql -q -v ON_ERROR_STOP=1 -U physics -d physics
  compose start api
  echo "restored"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/physics-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
compose exec -T db pg_dump -U physics -d physics --no-owner | gzip -9 > "$OUT.part"
mv "$OUT.part" "$OUT"
find "$BACKUP_DIR" -name 'physics-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "$OUT ($(du -h "$OUT" | cut -f1))"
