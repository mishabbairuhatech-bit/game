#!/usr/bin/env bash
# =============================================================================
# EMPIRE FRONTIER - PostgreSQL restore
#
#   ./scripts/restore-db.sh ./backups/empire_frontier_20260914T041500Z.dump
#
# DESTRUCTIVE: drops and recreates every object in the target database.
# Requires an explicit confirmation unless FORCE=1 is set.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

DUMP="${1:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
SERVICE="${POSTGRES_SERVICE:-postgres}"

if [[ -z "$DUMP" ]]; then
  echo "usage: $0 <dump-file>" >&2
  echo >&2
  echo "available dumps:" >&2
  ls -1t ./backups/*.dump 2>/dev/null | sed 's/^/  /' >&2 || echo "  (none in ./backups)" >&2
  exit 1
fi

if [[ ! -f "$DUMP" ]]; then
  echo "error: no such file: $DUMP" >&2
  exit 1
fi

if [[ -f .env ]]; then
  POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env | tail -1 | cut -d= -f2- || true)"
  POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env | tail -1 | cut -d= -f2- || true)"
fi
POSTGRES_USER="${POSTGRES_USER:-empire}"
POSTGRES_DB="${POSTGRES_DB:-empire_frontier}"

echo "About to restore into database '${POSTGRES_DB}' from:"
echo "  ${DUMP}"
echo
echo "This DROPS existing tables and their data."

if [[ "${FORCE:-0}" != "1" ]]; then
  read -r -p "Type the database name to confirm: " CONFIRM
  if [[ "$CONFIRM" != "$POSTGRES_DB" ]]; then
    echo "aborted." >&2
    exit 1
  fi
fi

if ! docker compose -f "$COMPOSE_FILE" ps --status running --services | grep -qx "$SERVICE"; then
  echo "error: the '${SERVICE}' service is not running." >&2
  exit 1
fi

# Stop the API first so nothing writes while the schema is being replaced.
STOPPED_BACKEND=0
if docker compose -f "$COMPOSE_FILE" ps --status running --services | grep -qx backend; then
  echo "→ stopping backend"
  docker compose -f "$COMPOSE_FILE" stop backend >/dev/null
  STOPPED_BACKEND=1
fi

echo "→ restoring"
# --clean --if-exists drops objects first; a non-zero exit from harmless
# "does not exist" notices is tolerated, real failures surface in the output.
docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE" \
  pg_restore \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --clean --if-exists \
    --no-owner --no-privileges \
    --single-transaction \
    --verbose \
  < "$DUMP"

echo "✓ restore complete"

if [[ "$STOPPED_BACKEND" == "1" ]]; then
  echo "→ starting backend"
  docker compose -f "$COMPOSE_FILE" start backend >/dev/null
fi

echo
echo "Verify with:  curl -s http://localhost/ready | head"
