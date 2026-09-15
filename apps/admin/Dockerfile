# =============================================================================
# EMPIRE FRONTIER - admin panel image
# Build context is the REPO ROOT (npm workspaces):
#   docker build -f apps/admin/Dockerfile .
# =============================================================================

FROM node:22-alpine AS base
RUN apk add --no-cache dumb-init
WORKDIR /app

# ---------------------------------------------------------------------- deps -
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json      packages/shared/
COPY packages/game-data/package.json   packages/game-data/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/ui/package.json          packages/ui/
COPY apps/api/package.json             apps/api/
COPY apps/web/package.json             apps/web/
COPY apps/admin/package.json           apps/admin/
# Scoped to this workspace so the image does not carry the API's
# dependency tree (Prisma engines alone are ~190MB).
RUN npm ci --workspace @empire/admin --include-workspace-root --no-audit --fund=false

# --------------------------------------------------------------- development -
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/admin ./apps/admin
COPY apps/admin/docker-entrypoint.dev.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 5174
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["npm", "run", "dev", "-w", "@empire/admin"]

# --------------------------------------------------------------------- build -
FROM base AS build
ENV NODE_ENV=production
ARG VITE_API_URL=/api
ARG VITE_BASE_PATH=/admin/
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_BASE_PATH=$VITE_BASE_PATH

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/admin ./apps/admin
RUN npm run build -w @empire/shared \
 && npm run build -w @empire/game-data \
 && npm run build -w @empire/game-engine \
 && npm run build -w @empire/admin

# ---------------------------------------------------------------- production -
FROM nginxinc/nginx-unprivileged:1.27-alpine AS production
USER root
RUN rm -rf /usr/share/nginx/html/*
# Served under /admin/ so the bundle's asset URLs resolve behind the edge proxy.
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html/admin
COPY apps/admin/nginx-spa.conf /etc/nginx/conf.d/default.conf
RUN chown -R nginx:nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
