#!/bin/sh
# -----------------------------------------------------------------------------
# Production entrypoint.
#
# Applies pending migrations, then execs the server. Migrations run here so a
# single `docker compose up` converges on a fresh host; set
# RUN_MIGRATIONS=false when a dedicated pipeline step owns that instead.
#
# Unlike the development entrypoint this NEVER falls back to `db push` — that
# can drop columns to force the schema into shape, which is not something a
# production database should ever do unattended.
# -----------------------------------------------------------------------------
set -e

SCHEMA=/app/apps/api/prisma/schema.prisma
log() { printf '[entrypoint] %s\n' "$*"; }

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  log "applying database migrations"

  if npx prisma migrate deploy --schema "$SCHEMA" 2>/tmp/migrate.err; then
    log "migrations up to date"
  elif grep -q "P3005" /tmp/migrate.err && [ "${BASELINE_EXISTING_SCHEMA:-false}" = "true" ]; then
    # Opt-in only: adopting a pre-existing schema is a deliberate one-off
    # operation, never something that should happen silently on deploy.
    log "BASELINE_EXISTING_SCHEMA=true - marking existing migrations as applied"
    for dir in /app/apps/api/prisma/migrations/*/; do
      name="$(basename "$dir")"
      npx prisma migrate resolve --schema "$SCHEMA" --applied "$name"
    done
    npx prisma migrate deploy --schema "$SCHEMA"
  else
    cat /tmp/migrate.err >&2
    log "migration failed - refusing to start with an unknown schema state"
    if grep -q "P3005" /tmp/migrate.err; then
      log "hint: this database has tables but no migration history."
      log "      Re-run once with BASELINE_EXISTING_SCHEMA=true to adopt it."
    fi
    exit 1
  fi
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  log "running seed"
  npx prisma db seed --schema "$SCHEMA" || log "seed failed - continuing"
fi

log "starting api"
exec "$@"
