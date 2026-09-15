#!/usr/bin/env bash
# =============================================================================
# EMPIRE FRONTIER - PostgreSQL backup
#
#   ./scripts/backup-db.sh                 # timestamped dump into ./backups
#   ./scripts/backup-db.sh /mnt/nas        # dump into another directory
#   BACKUP_KEEP=30 ./scripts/backup-db.sh  # keep the 30 newest dumps
#
# Uses pg_dump's custom format (-Fc): compressed, and restorable selectively
# with pg_restore, which a plain SQL dump cannot do.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
BACKUP_DIR="${1:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
SERVICE="${POSTGRES_SERVICE:-postgres}"

# Read credentials from .env without exporting the whole file into the shell.
if [[ -f .env ]]; then
  POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env | tail -1 | cut -d= -f2- || true)"
  POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env | tail -1 | cut -d= -f2- || true)"
fi
POSTGRES_USER="${POSTGRES_USER:-empire}"
POSTGRES_DB="${POSTGRES_DB:-empire_frontier}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTFILE="${BACKUP_DIR}/empire_frontier_${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

if ! docker compose -f "$COMPOSE_FILE" ps --status running --services | grep -qx "$SERVICE"; then
  echo "error: the '${SERVICE}' service is not running. Start it with 'docker compose up -d ${SERVICE}'." >&2
  exit 1
fi

echo "→ dumping ${POSTGRES_DB} as ${POSTGRES_USER}"
# Stream straight to the host so the dump never occupies space in the container.
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
  pg_dump \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --compress=6 \
    --no-owner \
    --no-privileges \
    --verbose \
  > "$OUTFILE" 2> >(grep -v '^pg_dump: dumping contents of table' >&2 || true)

SIZE="$(du -h "$OUTFILE" | cut -f1)"
echo "✓ wrote ${OUTFILE} (${SIZE})"

# Verify the dump is readable before trusting it - a silently truncated backup
# is worse than no backup.
#
# pg_restore has to seek within a custom-format archive, and /dev/stdin under
# `docker exec` is a pipe, so the dump is staged to a container temp file for
# the check and removed immediately afterwards.
echo "→ verifying"
if ! docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" sh -c '
      set -e
      tmp="$(mktemp)"
      trap "rm -f \"$tmp\"" EXIT
      cat > "$tmp"
      pg_restore --list "$tmp" > /dev/null
    ' < "$OUTFILE"; then
  echo "✗ the dump failed its readback check - do NOT rely on it." >&2
  exit 1
fi

TOC_ENTRIES="$(docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" sh -c '
      tmp="$(mktemp)"
      trap "rm -f \"$tmp\"" EXIT
      cat > "$tmp"
      pg_restore --list "$tmp" | grep -c "^[0-9]" || true
    ' < "$OUTFILE" | tr -d "[:space:]")"
echo "✓ readback check passed (${TOC_ENTRIES:-0} archive entries)"

# Retention.
if [[ "$BACKUP_KEEP" -gt 0 ]]; then
  COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -name 'empire_frontier_*.dump' | wc -l | tr -d ' ')"
  if [[ "$COUNT" -gt "$BACKUP_KEEP" ]]; then
    find "$BACKUP_DIR" -maxdepth 1 -name 'empire_frontier_*.dump' -print0 \
      | xargs -0 ls -1t \
      | tail -n +"$((BACKUP_KEEP + 1))" \
      | while read -r old; do
          echo "  pruning $(basename "$old")"
          rm -f "$old"
        done
  fi
fi

echo
echo "Restore with:  ./scripts/restore-db.sh ${OUTFILE}"
