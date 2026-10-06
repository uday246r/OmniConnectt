#!/usr/bin/env bash
# Restores ONE database of the local PostgreSQL from a backup made by backup-db.sh.
#
#   deploy/scripts/restore-db.sh /srv/omniconnect-backups/20261006-020000/lead_service.dump lead_service
#
# The database is replaced: everything written since that backup is lost. The service that owns it is
# stopped during the restore and started again afterwards. You are asked to type the database name to
# confirm.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

DUMP="${1:-}"; DB="${2:-}"
[[ -f "$DUMP" && -n "$DB" ]] || die "Usage: restore-db.sh <file.dump> <auth_service|lead_service|customer360_service|products_service>"
case "$DB" in
  auth_service) SVC=auth ;; lead_service) SVC=lead ;; customer360_service) SVC=c360 ;; products_service) SVC=products ;;
  *) die "Unknown database $DB." ;;
esac

warn "This REPLACES database $DB with the contents of $DUMP. Anything written since that backup is lost."
read -r -p "Type the database name ($DB) to continue: " answer
[[ "$answer" == "$DB" ]] || die "Not confirmed; nothing changed."

log "Stopping $SVC"
"${COMPOSE[@]}" stop "$SVC"
log "Restoring $DB"
"${COMPOSE[@]}" exec -T db psql -U postgres -q -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" -c "CREATE DATABASE \"$DB\";"
"${COMPOSE[@]}" exec -T db pg_restore -U postgres --no-owner -d "$DB" < "$DUMP"
log "Starting $SVC"
"${COMPOSE[@]}" up -d --wait "$SVC"
ok "$DB restored from $DUMP."
