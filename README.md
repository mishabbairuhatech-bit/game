# Empire Frontier

A Dockerized multiplayer 3D browser strategy game. Build a stronghold, claim
territory on a persistent world grid, raise an army, raid rivals, and trade land
with other players on a server-authoritative marketplace.

Everything runs in Docker. You do **not** need Node.js, PostgreSQL, Redis or
NGINX installed on your machine.

> **On virtual property.** Plots, resources and currencies in Empire Frontier are
> virtual in-game items. They carry no real-world value, confer no real-world
> property rights, and are not an investment.

> **Originality.** All game data, art, names, mechanics and code in this
> repository are original to this project. No third-party game assets, artwork,
> audio, text or source code are used.

---

## Quick start

```bash
git clone <your-repo-url> empire-frontier
cd empire-frontier
cp .env.example .env          # then edit the secrets, see "Environment" below
docker compose up -d --build
```

Then open:

| What              | URL                             |
| ----------------- | ------------------------------- |
| Game client       | http://localhost                |
| Admin panel       | http://localhost/admin          |
| API               | http://localhost/api/v1         |
| API docs (Swagger)| http://localhost/docs           |
| Backend health    | http://localhost/api/health     |
| Readiness         | http://localhost/api/ready      |

The first build takes a few minutes (Three.js and the NestJS toolchain are
large). The backend container applies the database schema and runs an idempotent
seed on startup, so the game is playable as soon as the stack is healthy.

### Finding the admin password

The seed creates one `SUPER_ADMIN` account. No password is ever hardcoded: if
`SEED_ADMIN_PASSWORD` is blank in `.env`, a strong random password is generated
and printed **once** to the API log.

```bash
docker compose logs backend | grep -A4 "BOOTSTRAP ADMIN"
```

Sign in at http://localhost/admin and change it immediately.

---

## Everyday commands

```bash
docker compose up -d --build      # build and start everything
docker compose ps                 # service status and health
docker compose logs -f            # tail all logs
docker compose logs -f backend    # tail one service
docker compose restart backend    # restart one service
docker compose down               # stop, keep the data volumes
docker compose down -v            # stop and DELETE all game data
```

### Database

```bash
# Create a migration from schema changes (development)
docker compose exec backend npx prisma migrate dev --name describe_your_change

# Apply pending migrations without prompting (CI / production)
docker compose exec backend npx prisma migrate deploy

# Re-run the seed (idempotent - it upserts, it does not duplicate)
docker compose exec backend npx prisma db seed

# Browse the data
docker compose exec backend npx prisma studio   # then open http://localhost:5555

# psql shell
docker compose exec postgres psql -U empire -d empire_frontier
```

### Tests and checks

```bash
npm run verify          # lint + typecheck + unit tests, all workspaces
npm run lint            # eslint, zero warnings tolerated
npm run typecheck       # tsc --noEmit everywhere

# Unit tests (pure logic - no database needed)
docker compose exec backend npx jest

# Phase 1 acceptance suite - boots the real app against the real
# PostgreSQL and Redis. Nothing is mocked.
docker compose exec backend npm run test:e2e -w @empire/api
```

The acceptance suites cover, for Phase 1: registration, password hashing,
login, refresh rotation and reuse detection, logout, logout-everywhere, the
role gate, mass assignment, the error envelope, ledger reconciliation and rate
limiting. For Phase 2: world hierarchy and duplicate coordinates, deterministic
generation, viewport bounds and the plot cap, filters, owner-id leakage, plot
detail, starter assignment under five concurrent registrations, the purchase
happy path, and eight refusal cases.

176 cases in total — 99 unit, 77 integration.

### Backups

```bash
./scripts/backup-db.sh                  # timestamped dump into ./backups
./scripts/backup-db.sh /mnt/nas         # dump elsewhere
BACKUP_KEEP=30 ./scripts/backup-db.sh   # retain the 30 newest dumps

./scripts/restore-db.sh ./backups/empire_frontier_<stamp>.dump
```

`backup-db.sh` uses `pg_dump -Fc` (compressed custom format, selectively
restorable) and reads the dump back with `pg_restore --list` before reporting
success — a silently truncated backup is worse than no backup.
`restore-db.sh` stops the API, restores inside a single transaction, and starts
the API again. It refuses to run without an explicit confirmation.

### Optional dev object storage

MinIO is behind a compose profile so it does not run unless you ask for it:

```bash
docker compose --profile storage up -d
# console at http://localhost:9001
```

---

## Architecture

```
                          Internet
                             │
                             ▼
                    ┌──────────────────┐
                    │      NGINX       │  :80  (the only published port)
                    │  reverse proxy   │
                    └────────┬─────────┘
              ┌──────────────┼───────────────┐
              ▼              ▼               ▼
        /  ────────►   /api/ ───────►   /admin/ ────►
      ┌──────────┐   ┌──────────────┐   ┌──────────┐
      │ frontend │   │   backend    │   │  admin   │
      │  React   │   │   NestJS     │   │  React   │
      │ Three.js │   │  Socket.IO   │   │          │
      └──────────┘   └──────┬───────┘   └────┬─────┘
                            │                │
                     ┌──────┴──────┐         │
                     ▼             ▼         │
              ┌────────────┐  ┌────────┐     │
              │ PostgreSQL │  │ Redis  │     │
              │  (volume)  │  │(volume)│     │
              └────────────┘  └────────┘     │
                     ▲                       │
                     └───────────────────────┘
                         admin → backend API

  /socket.io/  ──►  backend  (websocket upgrade, Redis pub/sub adapter)
```

All inter-service traffic uses Docker service names on the `empire_network`
bridge — never `localhost`:

```
DATABASE_URL=postgresql://empire:...@postgres:5432/empire_frontier
REDIS_URL=redis://:...@redis:6379
```

### Services

| Service    | Image / build         | Internal port | Published |
| ---------- | --------------------- | ------------- | --------- |
| `nginx`    | `nginx:1.27-alpine`   | 80            | **80**    |
| `frontend` | `apps/web/Dockerfile` | 5173 / 8080   | no        |
| `backend`  | `apps/api/Dockerfile` | 4000          | no        |
| `admin`    | `apps/admin/Dockerfile` | 5174 / 8080 | no        |
| `postgres` | `postgres:17-alpine`  | 5432          | dev only, `127.0.0.1` |
| `redis`    | `redis:7-alpine`      | 6379          | dev only, `127.0.0.1` |
| `minio`    | `minio/minio`         | 9000/9001     | `storage` profile |

In `docker-compose.prod.yml` PostgreSQL and Redis publish nothing at all.

---

## The world

A persistent grid, partitioned three ways so the client can stream a slice of
it rather than all of it:

```
WORLD  1000 x 1000 tiles
└── REGION  100 x 100 tiles   →  10 x 10  =    100 regions
    └── ZONE  20 x 20 tiles   →  50 x 50  =  2 500 zones
        └── PLOT  10 x 10     → 100 x 100 = 10 000 plots
```

Every size is configurable from the admin panel (`world.*`) and validated at
generation time — the tiers must divide evenly, or partial regions at the edge
would break coordinate maths everywhere downstream.

### Deterministic generation

Terrain is a pure function of `(seed, coordinates)`. The same seed always
produces the same world, so only the seed is persisted — never a per-tile
heightmap. Three noise fields (elevation, moisture, temperature) plus a ridged
river field are layered and read into a biome, which is why mountains form
ranges and water forms lakes instead of a confetti of unrelated tiles. An edge
falloff pulls elevation down near the boundary, so the world reads as an island
rather than terrain sliced off by the map edge.

```bash
WORLD_SEED=EMPIRE-001 docker compose exec backend npx prisma db seed
```

Twelve biomes, each with a terrain rule in `@empire/game-data` covering
buildability, traversability, price modifier, yield bonus, colour, glyph and
fill pattern:

| Buildable | Conditional | Blocked |
| --------- | ----------- | ------- |
| Grassland, Desert, Highland, Badlands, Tundra | Forest, Swamp, Rocky, Riverland, Lakeshore | Mountain, Water |

Blocked ground is generated as `UNAVAILABLE`, which is a terminal state — water
and mountain are scenery, not inventory, and can never be claimed or sold.

### Plot lifecycle

Every status change goes through one transition table
(`@empire/game-engine/plot-state`), so an illegal transition is impossible to
express rather than merely unlikely:

```
FREE ──────► OWNED ──────► FOR_SALE ──────► OWNED
  └────────► STARTER          (Phase 6)
```

Notable refusals are deliberate: the world does not list its own land
(`FREE → FOR_SALE`), and a player cannot sell the ground their keep stands on
(`STARTER → FOR_SALE`).

### Starter territory

A new account is granted a buildable starter holding inside one transaction
with the rest of its provisioning — an empire with no land is a player who
cannot play. Allocation picks from a bounded pool of eligible plots (right
biome, mostly dry, away from the world edge) and enforces a minimum distance
from every existing holding, so players are spread out rather than piled up.

Two simultaneous signups cannot be handed the same ground: the claim is a
guarded `UPDATE ... WHERE status='FREE' AND owner_id IS NULL`, so the loser
matches zero rows and moves to the next candidate.

### Map API

| Endpoint | Purpose |
| -------- | ------- |
| `GET /api/v1/world` | Geometry, seed and occupancy counters |
| `GET /api/v1/world/regions` | Far-zoom summary layer |
| `GET /api/v1/world/regions/:id` | One region with its counters |
| `GET /api/v1/world/regions/:id/zones` | Zones inside a region |
| `GET /api/v1/world/zones/:id` | One zone and its plots |
| `GET /api/v1/world/plots?minX&minY&maxX&maxY` | Viewport query |
| `GET /api/v1/world/search?q=` | Plot code, `x,y`, or commander name |
| `GET /api/v1/plots/:idOrCode` | Full plot detail and permitted actions |
| `GET /api/v1/player/territory` | The caller's holdings and camera bounds |
| `GET /api/v1/player/territory/nearby` | Expansion shortlist |
| `POST /api/v1/player/territory/purchase` | Claim a FREE plot |

Viewport bounds are **mandatory** and are clamped to the world and to 2 500
plots before the query runs, so no request — however crafted — can pull the
whole world into one response. A narrowed response sets `truncated: true` so
the client falls back to region summaries instead of silently showing partial
data.

The map reads use *optional* authentication: anyone may look at the world, and
a signed-in caller additionally sees which plots are theirs and what they may
do with each one. The `actions` block is computed server-side, so the UI can
never offer a button the API would refuse.

### Buying land

The request carries **only a plot id**. Price, adjacency, plot limit, HQ level,
cooldown and the coin debit are all resolved server-side inside one
`SERIALIZABLE` transaction, and the transfer is a guarded update — two
simultaneous buyers cannot both succeed. Every purchase appends a
`CurrencyTransaction` and a `PlotOwnership` row linked by `transactionId`, so
land and money reconcile against each other.

---

## Technology

**Frontend** React 19 · TypeScript · Vite · Three.js · React Three Fiber · Drei ·
Zustand (six focused stores) · Tailwind CSS v4
**Backend** Node.js 22 · TypeScript · NestJS 11 · Prisma 6 · Socket.IO 4 · Pino
**Data** PostgreSQL 17 · Redis 7
**Infra** NGINX 1.27 · Docker · Docker Compose
**Testing** Jest (server) · Vitest (client) · Playwright (end to end)

---

## Repository layout

```
empire-frontier/
├── docker-compose.yml          # development stack
├── docker-compose.prod.yml     # production stack
├── .env.example                # environment template (never commit .env)
│
├── apps/
│   ├── web/                    # game client (React + Three.js)
│   ├── api/                    # backend (NestJS + Prisma + Socket.IO)
│   │   └── prisma/
│   │       ├── schema.prisma   # 40+ models
│   │       └── seed.ts         # idempotent catalogue + bootstrap admin
│   └── admin/                  # operations panel
│
│   apps/api/src/world/         # generator, map queries, territory ownership
│   apps/web/src/game/map/      # instanced plot + region layers, LOD
│   apps/web/src/store/         # world / map / plot / territory / empire / auth
│
├── packages/
│   ├── shared/                 # API envelope, error codes, enums, socket events
│   ├── game-data/              # buildings, units, resources, terrain rules,
│   │                           #   world geometry, tuning defaults
│   ├── game-engine/            # deterministic RNG + world generator, grid
│   │                           #   maths, plot state machine, power, accrual
│   └── ui/                     # design tokens + shared React primitives
│
├── assets/                     # 3D models and audio (GLB/GLTF), served at /assets
├── nginx/                      # nginx.conf, conf.d/, includes/
├── scripts/                    # backup, restore, postgres init
└── tests/                      # end-to-end suites
```

### The three shared packages

`@empire/shared` is the contract between client and server: the response
envelope, the error-code catalogue, the enums mirrored from Prisma, the
Socket.IO event names, and the password policy. Both sides import the same
rules, so the browser can never validate differently from the server.

`@empire/game-data` is the balance sheet: every building with a generated level
curve, every unit, every resource, the terrain rules for all twelve biomes,
world geometry and coordinate maths, and the default tuning values. Nothing
here is art — each definition points at art through an `asset` block (see
*Asset pipeline*). The terrain rules live here rather than in the renderer
because a client that disagrees with the server about which ground is buildable
is a bug the player sees.

`@empire/game-engine` holds the pure functions that must be identical
everywhere: a deterministic PRNG and value noise, the world generator built on
them, the plot state machine, footprint geometry, empire-power scoring and the
offline production accrual formula.

The packages compile to CommonJS for NestJS. The Vite apps alias them to their
TypeScript **source** instead, which avoids CJS/ESM interop problems and means
no build step is needed before `vite dev`.

---

## Environment

Copy `.env.example` to `.env` and set real values. The API refuses to start in
production with a placeholder `JWT_SECRET` or one shorter than 32 characters.

```bash
# Generate secrets
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD, REDIS_PASSWORD
```

| Variable | Purpose |
| -------- | ------- |
| `DATABASE_URL` | PostgreSQL connection string (host `postgres`) |
| `REDIS_URL` | Redis connection string (host `redis`) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Access and refresh token signing keys |
| `SESSION_SECRET` | Session/cookie signing |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth; leave blank to disable |
| `PAYMENT_PROVIDER` | `razorpay`, `stripe` or `none` |
| `PAYMENT_KEY` / `PAYMENT_SECRET` / `PAYMENT_WEBHOOK_SECRET` | Payment provider credentials |
| `CORS_ORIGIN` | Comma-separated allowed origins |
| `API_URL` / `WEB_URL` / `ADMIN_URL` | Public URLs used in emails and redirects |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | Bootstrap admin; leave the password blank to auto-generate |
| `AUTH_REQUIRE_VERIFIED_EMAIL` | Gate gameplay behind email verification (on by default in production) |

`.env` is gitignored. Never commit it.

### Email in development

`MAIL_DRIVER=log` (the default) writes verification and password-reset emails —
including the clickable link — to the API log, so the whole auth flow works with
no SMTP account:

```bash
docker compose logs -f backend | grep -A8 "OUTGOING MAIL"
```

---

## Hot reload

The development compose file bind-mounts each app's `src/` into its container
and keeps `node_modules` in a named volume, so dependencies stay as the image
installed them while your edits apply instantly.

- **Frontend / Admin** — Vite HMR. The websocket is advertised on port 80
  because the browser reaches Vite through NGINX, not directly.
- **Backend** — `nest start --watch`. Saving a `.ts` file restarts the server;
  the container keeps running.
- **Packages** — the dev entrypoints compile `@empire/shared`,
  `@empire/game-data` and `@empire/game-engine` before the app starts (the bind
  mount hides whatever the image built). The Vite apps read package *source*, so
  a package edit hot-reloads in the browser with no rebuild.

None of these mounts exist in `docker-compose.prod.yml`.

---

## Production

```bash
cp .env.example .env    # fill in real secrets first
docker compose -f docker-compose.prod.yml up -d --build
```

Differences from development:

- multi-stage `production` targets; the client and admin ship as static bundles
  served by `nginx-unprivileged`
- every app container runs as a **non-root** user
- no source bind mounts — code is baked into the image
- PostgreSQL and Redis publish **no** host ports
- NGINX is the single ingress, with a strict CSP, HSTS and per-route rate limits
- `restart: always`, healthchecks and resource limits on every service
- `prisma migrate deploy` runs from the API entrypoint on boot
  (set `RUN_MIGRATIONS=false` if a separate pipeline step owns migrations)

### TLS

Put `fullchain.pem` and `privkey.pem` in `nginx/certs/`, then uncomment the
`:443` server block and the HTTP→HTTPS redirect in `nginx/conf.d/prod.conf`.

### Scaling out

The API is stateless: sessions live in PostgreSQL, caches and rate-limit
counters in Redis, and Socket.IO rooms fan out through the Redis pub/sub
adapter. That makes replicas safe:

```bash
API_REPLICAS=3 docker compose -f docker-compose.prod.yml up -d
```

Two details make this work rather than merely appear to: the throttler uses a
Redis-backed store (the in-memory default would multiply every rate limit by the
replica count), and `server.to(room).emit()` reaches sockets on every node
because of the Redis adapter.

---

## Security posture

- **Passwords** bcrypt (12 rounds by default), never stored or logged in
  plaintext. Login spends the same time on a missing account as a wrong password
  so response timing cannot enumerate registered emails.
- **Access tokens** short-lived (15 min) JWTs, kept in browser memory only —
  never `localStorage`, so an XSS bug cannot steal a long-lived credential.
  Every request re-checks the account in the database, so a ban takes effect
  immediately rather than when the token expires.
- **Refresh tokens** stored hashed, rotated on every use, with reuse detection:
  presenting an already-rotated token revokes the whole session family.
  Delivered as an `httpOnly` cookie scoped to `/api`.
- **Roles** `PLAYER` → `MODERATOR` → `ADMIN` → `SUPER_ADMIN`, compared by rank
  so a higher role always satisfies a lower requirement.
- **Default-closed routing** every endpoint is authenticated unless explicitly
  marked `@Public()`.
- **Input validation** `class-validator` with `whitelist` and
  `forbidNonWhitelisted`, so a client cannot smuggle `role: "ADMIN"` into a
  registration body.
- **Rate limiting** at NGINX (per route) and in the API (per account, Redis-backed).
- **SQL injection** Prisma parameterises everything; no string-built SQL.
- **Headers** Helmet on the API, plus CSP, HSTS, `X-Frame-Options`,
  `X-Content-Type-Options` and a restrictive `Permissions-Policy` at NGINX.
- **Audit logging** every admin mutation and every security-relevant user action
  writes an append-only `AuditLog` row with redacted before/after values.

### Server authority

The client is a renderer and an input device. It never decides a coin balance, a
resource total, a building placement, a battle result or a payment outcome.

- Currencies move only through `WalletService`, which performs the balance check
  and the write in a single guarded `UPDATE` — two concurrent spends cannot both
  pass — and appends exactly one ledger row in the same transaction.
- Money-moving operations accept an idempotency key; replaying it returns the
  recorded balance instead of applying the change twice.
- Resources accrue from `elapsedTime × rate` computed server-side and clamped to
  storage, with a hard cap on how much offline time counts. Browser timers are
  display-only.
- Ownership transfers and marketplace settlements run in `SERIALIZABLE`
  transactions with automatic retry on write conflicts.

---

## Asset pipeline

`assets/` holds original 3D models and audio, served at `/assets/...` and
cached by NGINX. Recommended format: **GLB/GLTF**.

Gameplay code never names a file. Each definition in `@empire/game-data` carries
an `asset` block:

```ts
asset: {
  model: null,                        // null → render the procedural placeholder
  placeholder: { shape: 'tower', color: '#c8a165', scale: [4, 5, 4] },
  lod: { high: 40, medium: 90, low: 200 },
}
```

Today `model` is `null` everywhere and `PlaceholderMesh` renders a readable
primitive, so the game is playable before any art exists. Dropping
`buildings/hq_lv1.glb` into `assets/` and setting `model` to that path swaps the
art with **no change to gameplay code**. The definitions are seeded into
`BuildingDefinition.asset` / `UnitDefinition.asset`, so the swap can also be
done from the admin panel without a deploy.

### Rendering performance

The map draws up to 2 500 plots as a **single instanced mesh** — as individual
meshes that would be 2 500 draw calls per frame, which stutters on any laptop.
Above a camera-distance threshold the plot layer is swapped for a region layer
(one instance per region, a hundred for the whole world) and plot streaming
stops entirely: at that height an individual plot is sub-pixel, so drawing them
buys nothing but draw calls. The two layers are mutually exclusive — drawing
regions *under* the plots looks reasonable and is wrong, because a region slab
is taller than an unclaimed plot and swallows it.

Viewport queries project only the eight fields the map needs. Returning the
default row (which includes the per-plot `terrain` JSON) took 5.4 s for one
window; narrowing the projection brought it to 0.28 s.

Also: instanced scatter props in the empire view, frustum culling, `AdaptiveDpr`
and `AdaptiveEvents` to drop resolution while the camera moves, a DPR ceiling of
1.75, and Three.js split into its own cache-stable bundle chunk.

### Map accessibility

Plot status is encoded three ways — colour, **height** and **edge** — plus a
glyph in the legend and a text label in the detail panel. A map where "mine"
and "someone else's" differ only in hue is unusable for a player with a
colour-vision deficiency, and the height encoding survives a greyscale
screenshot.

---

## API conventions

Every response uses one envelope. Success:

```json
{ "success": true, "data": { "...": "..." } }
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_COINS",
    "message": "Not enough coins.",
    "requestId": "3f2a...",
    "timestamp": "2026-09-14T04:15:00.000Z"
  }
}
```

Branch on `error.code`, never on `error.message`. The full catalogue lives in
`packages/shared/src/error-codes.ts` and is shared by both sides.

Every request carries an `X-Request-Id` (reusing NGINX's when present) which is
echoed on the response, attached to every log line for that request, and
included in error bodies — so a player-reported error can be traced straight to
its request.

Interactive docs: http://localhost/docs · machine-readable:
http://localhost/docs-json

---

## Observability

Structured JSON logs via Pino, pretty-printed in development. Authentication,
API errors, payments, marketplace settlements, currency movements, battles and
admin actions are all logged. Authorization headers, cookies, passwords and
token hashes are redacted at the logger.

Two deliberately different probes:

- `GET /api/health` — **liveness**. No dependency calls, so a database blip
  never causes Docker to kill an otherwise-healthy container.
- `GET /api/ready` — **readiness**. Verifies PostgreSQL and Redis, returns
  `503` when either is down so a load balancer can drain the instance.

Both are version-neutral, so the container healthcheck URL does not move when
the API version bumps. NGINX also aliases the bare `/health` and `/ready` onto
them for uptime monitors that expect root-level probes.

In production, liveness stays public (it reports no internal state) while
readiness is denied at NGINX — it exposes dependency latency and error
strings. The container healthcheck reaches it directly on `:4000`.

---

## Persistence

All game state lives in PostgreSQL. Redis holds only derived or ephemeral data
(caches, rate-limit counters, leaderboard snapshots, Socket.IO fan-out) and can
be flushed without losing anything a player would miss.

State survives a browser refresh, a logout, a server restart and
`docker compose down` — both databases use named volumes
(`empire_postgres_data`, `empire_redis_data`). Only `docker compose down -v`
deletes them.

Nothing important is stored in `localStorage`.

---

## Build order

The project is built in phases; each one leaves the stack running and healthy.

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 1 | Docker, PostgreSQL, Redis, NGINX, backend, frontend, admin, authentication | **done** |
| 2 | 3D world map, world generator, regions/zones/plots, starter territory, land expansion | **done** |
| 3 | Buildings, 3D placement, resources, upgrades | next |
| 4 | Army, training queues, defence | |
| 5 | Server-authoritative PvP battles and results | |
| 6 | Land expansion, ownership, marketplace, player-to-player sales | |
| 7 | Premium currency, payment integration, wallet, ledger | |
| 8 | Alliances, chat, quests, achievements, leaderboards | |
| 9 | Admin panel, analytics, moderation, anti-cheat | |
| 10 | Optimisation, testing, production Docker, backups, deployment | |

The side menu in the game client and the admin sidebar label each screen with
the phase that makes it functional, and screens that are not wired up yet are
visibly disabled — nothing in the UI silently does nothing.

Per-phase notes, including how to test each one and its known limitations:
[`docs/PHASE-1.md`](docs/PHASE-1.md) · [`docs/PHASE-2.md`](docs/PHASE-2.md)

---

## Troubleshooting

**`http://localhost/api/health` 404s.**
The API is still compiling on first boot. `docker compose logs -f backend` and
wait for `listening on :4000`.

**The stack is up but `http://localhost` shows a 502.**
The Vite dev server takes a moment on first boot. `docker compose logs -f frontend`
and wait for `ready in …ms`.

**`backend` restarts in a loop.**
Almost always a bad `DATABASE_URL` or a missing `JWT_SECRET`.
`docker compose logs backend | head -40` will name it.

**Port 80 is already in use.**
Set `HTTP_PORT=8080` in `.env` and use `http://localhost:8080`.

**Port 5432 or 6379 is already in use.**
Those are the loopback-only convenience mappings for a local SQL client. They
default to `5433` and `6380` for exactly this reason; change
`POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` in `.env` if they still clash, or
delete the `ports:` blocks — nothing in the stack needs them.

**Schema changes are not showing up.**
`docker compose exec backend npx prisma migrate dev`, then restart the backend.

**Windows or macOS file changes are not detected.**
Polling is already enabled via `CHOKIDAR_USEPOLLING=true`. If it is still slow,
raise the interval in `apps/*/vite.config.ts`.

**I want a completely clean slate.**
`docker compose down -v && docker compose up -d --build` — this deletes all
game data.
