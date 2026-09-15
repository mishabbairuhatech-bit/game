#!/bin/sh
# Dev entrypoint: docker-compose bind-mounts ./packages over the image's copy,
# so the workspace packages have to be compiled here for their dist/ to exist.
# @empire/ui is consumed as TypeScript source and needs no build step.
set -e
cd /app
printf '\033[36m[entrypoint]\033[0m building workspace packages\n'
npm run build -w @empire/shared      --silent
npm run build -w @empire/game-data   --silent
npm run build -w @empire/game-engine --silent
printf '\033[36m[entrypoint]\033[0m starting: %s\n' "$*"
exec "$@"
