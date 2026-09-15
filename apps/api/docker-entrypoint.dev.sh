#!/bin/sh
# -----------------------------------------------------------------------------
# Development entrypoint.
#
# docker-compose bind-mounts ./packages over the image's copy, so whatever the
# build stage compiled is gone by the time this runs. Compile the workspace
# packages here, then bring the schema up to date, then hand over to Nest's
# watcher. Compiled output lands on the host bind mount, which also makes
# `npm run typecheck` work outside Docker.
# -----------------------------------------------------------------------------
set -e

cd /app

SCHEMA=apps/api/prisma/schema.prisma
log() { printf '\033[36m[entrypoint]\033[0m %s\n' "$*"; }

log "building workspace packages"
npm run build -w @empire/shared      --silent
npm run build -w @empire/game-data   --silent
npm run build -w @empire/game-engine --silent

log "generating prisma client"
npx prisma generate --schema "$SCHEMA"

# Apply migrations. Two cases need handling beyond the happy path:
#
#   * A database created by an older `db push` has the tables but no migration
#     history, so `migrate deploy` aborts with P3005. Baseline it by marking
#     the initial migration as already applied, then continue.
#   * A drifted development database (schema edited without a migration) is
#     resolved with `db push`, which is safe here and never runs in production.
log "applying migrations"
if npx prisma migrate deploy --schema "$SCHEMA" 2>/tmp/migrate.err; then
  log "migrations up to date"
elif grep -q "P3005" /tmp/migrate.err; then
  log "existing schema with no migration history - baselining"
  for dir in apps/api/prisma/migrations/*/; do
    name="$(basename "$dir")"
    npx prisma migrate resolve --schema "$SCHEMA" --applied "$name" || true
  done
  npx prisma migrate deploy --schema "$SCHEMA"
else
  cat /tmp/migrate.err >&2
  log "migrate deploy failed - falling back to db push (development only)"
  npx prisma db push --schema "$SCHEMA" --accept-data-loss --skip-generate
fi

if [ "${AUTO_SEED:-true}" = "true" ]; then
  log "seeding (idempotent)"
  npm run db:seed -w @empire/api || log "seed failed - continuing so the API still boots"
fi

cd /app/apps/api
log "starting: $*"
exec "$@"
