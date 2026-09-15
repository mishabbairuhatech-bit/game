# =============================================================================
# EMPIRE FRONTIER - backend image
# Build context is the REPO ROOT (npm workspaces), not apps/api:
#   docker build -f apps/api/Dockerfile .
# =============================================================================

# ---------------------------------------------------------------------- base -
FROM node:22-alpine AS base
# openssl: required by Prisma's query engine on musl.
# dumb-init: proper PID 1 so SIGTERM reaches node and shutdown stays graceful.
RUN apk add --no-cache openssl dumb-init curl \
    && corepack disable
WORKDIR /app
ENV NODE_OPTIONS="--enable-source-maps"

# ---------------------------------------------------------------------- deps -
# Manifests only, so `npm ci` is cached until a dependency actually changes.
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json      packages/shared/
COPY packages/game-data/package.json   packages/game-data/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/ui/package.json          packages/ui/
COPY apps/api/package.json             apps/api/
COPY apps/web/package.json             apps/web/
COPY apps/admin/package.json           apps/admin/
# Scoped to this workspace: a bare root `npm ci` installs every workspace's
# dependencies, which would put ~170MB of browser-only packages (three.js,
# mediapipe, hls.js) into the API image. `--include-workspace-root` keeps the
# root devDependencies that build the shared packages.
RUN npm ci --workspace @empire/api --include-workspace-root --no-audit --fund=false

# --------------------------------------------------------------- development -
# Sources are bind-mounted by docker-compose.yml; the entrypoint compiles the
# workspace packages and generates the Prisma client before starting Nest in
# watch mode.
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/api/docker-entrypoint.dev.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
WORKDIR /app/apps/api
EXPOSE 4000
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "start:dev"]

# --------------------------------------------------------------------- build -
FROM base AS build
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/api ./apps/api
# Workspace packages first - the API imports their compiled output.
RUN npm run build -w @empire/shared \
 && npm run build -w @empire/game-data \
 && npm run build -w @empire/game-engine
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build -w @empire/api

# --------------------------------------------------------------- prod-deps ---
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json      packages/shared/
COPY packages/game-data/package.json   packages/game-data/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/ui/package.json          packages/ui/
COPY apps/api/package.json             apps/api/
COPY apps/web/package.json             apps/web/
COPY apps/admin/package.json           apps/admin/
RUN npm ci --omit=dev --workspace @empire/api --include-workspace-root \
      --no-audit --fund=false \
 && npm cache clean --force

# ---------------------------------------------------------------- production -
FROM base AS production
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./

# Workspace packages: manifest + compiled output only (no TypeScript sources).
COPY --from=build --chown=node:node /app/packages/shared/package.json      ./packages/shared/
COPY --from=build --chown=node:node /app/packages/shared/dist              ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/game-data/package.json   ./packages/game-data/
COPY --from=build --chown=node:node /app/packages/game-data/dist           ./packages/game-data/dist
COPY --from=build --chown=node:node /app/packages/game-engine/package.json ./packages/game-engine/
COPY --from=build --chown=node:node /app/packages/game-engine/dist         ./packages/game-engine/dist

COPY --from=build --chown=node:node /app/apps/api/dist         ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /app/apps/api/prisma       ./apps/api/prisma
COPY --chown=node:node apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Prisma client for the production dependency tree.
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && chown -R node:node /app/node_modules/.prisma 2>/dev/null || true

WORKDIR /app/apps/api
USER node
EXPOSE 4000

# curl rather than `node -e`: booting a Node runtime every 15s is far more
# expensive than the request it makes, and under load the probe itself becomes
# the reason the container is marked unhealthy.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS -m 4 -o /dev/null "http://127.0.0.1:${PORT:-4000}/api/health"

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/main.js"]
