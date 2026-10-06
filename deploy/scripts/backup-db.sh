#!/usr/bin/env bash
# Backs up the four databases of the local PostgreSQL (COMPOSE_PROFILES=localdb).
#
#   deploy/scripts/backup-db.sh                 # one dump per database into $BACKUP_ROOT/<timestamp>/
#   KEEP_DAYS=30 deploy/scripts/backup-db.sh
#
# Custom-format dumps (pg_dump -Fc): compressed, and restorable one database at a time with
# scripts/restore-db.sh. Older backups than KEEP_DAYS (default 14) are removed.
#
# A backup on the same machine protects against mistakes, not against losing the machine: copy
# $BACKUP_ROOT somewhere else regularly (see docs/DEPLOY-WINDOWS-SERVER-2022.md, "Backups").
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[[ ",${COMPOSE_PROFILES:-}," == *",localdb,"* ]] \
  || die "This installation does not use the local PostgreSQL (COMPOSE_PROFILES=localdb); back up the managed database with its own tools."

BACKUP_ROOT="${BACKUP_ROOT:-/srv/omniconnect-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_ROOT/$STAMP"
mkdir -p "$TARGET"
chmod 700 "$BACKUP_ROOT"

for db in auth_service lead_service customer360_service products_service; do
  "${COMPOSE[@]}" exec -T db pg_dump -U postgres -Fc "$db" > "$TARGET/$db.dump" \
    || die "Backing up $db failed (is the db container running? docker compose ps)."
  [[ -s "$TARGET/$db.dump" ]] || die "$db produced an empty dump."
  ok "$db → $TARGET/$db.dump ($(du -h "$TARGET/$db.dump" | cut -f1))"
done

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -print -exec rm -rf {} + \
  | sed 's/^/removed old backup: /'
ok "Backup complete: $TARGET"
