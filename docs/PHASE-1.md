# Phase 1 — Foundation

Docker, PostgreSQL, Redis, NGINX, backend, frontend, admin, authentication.

Verified on a wiped-volume `docker compose up -d --build`: all six services
healthy, migrations applied from an empty database, seed run, and the full
register → play → admin flow exercised through NGINX.

---

## What was implemented

### Infrastructure

Six services on the `empire_network` bridge, all addressing each other by
Docker service name. NGINX is the only service that publishes a port.

`nginx` routes `/` → frontend, `/api/` → backend, `/socket.io/` → backend with
websocket upgrade, `/admin/` → admin, `/assets/` → static 3D assets. It applies
gzip, security headers, static caching and three separate rate-limit zones
(30r/s API, 5r/m auth, 20r/s admin).

PostgreSQL 17 and Redis 7 both use named volumes. In development they publish
loopback-only ports offset to **5433** and **6380** so they never collide with a
PostgreSQL or Redis already installed on the developer's machine — which is
exactly what happened during this build.

### Database

A 52-table schema covering every model the specification lists, plus the ones
the game genuinely needs (`Empire`, `BuildingDefinition`, `UnitDefinition`,
`GameConfig`, `PaymentPackage`, `PaymentWebhookEvent`, `SuspiciousActivity`,
`RefreshToken`, `VerificationToken`, `OAuthAccount`). 124 indexes, foreign keys
throughout, `citext` for case-insensitive email/username uniqueness.

A real initial migration ships in `prisma/migrations/00000000000000_init` —
1557 lines covering every table, enum, index and extension. It was generated
with `prisma migrate diff --from-empty`, and verified by wiping the volume and
watching `migrate deploy` build the database from nothing.

Money columns are `BigInt`, serialised to JSON as decimal **strings** rather
than numbers: a balance above 2^53 would silently lose precision as a JS number,
and a wrong coin balance is not an acceptable rounding error.

### Authentication

Register, login, logout, logout-everywhere, refresh, email verification,
password reset, password change, and Google OAuth.

- bcrypt at 12 rounds; login spends the same time on a missing account as on a
  wrong password, so timing cannot enumerate registered emails.
- 15-minute access JWTs, re-validated against the database on every request so
  a ban takes effect immediately rather than when the token expires.
- Refresh tokens stored hashed, rotated on every use, with **reuse detection** —
  replaying a rotated token revokes the entire session family.
- The refresh token is an `httpOnly` cookie scoped to `/api`; the access token
  never leaves memory, so an XSS bug cannot steal a long-lived credential.
- `forgot-password` and `resend-verification` always return 202, so neither can
  be used to probe which addresses are registered.
- Google OAuth is registered conditionally — with no credentials the strategy is
  never constructed and the route answers `OAUTH_PROVIDER_DISABLED` instead of
  crashing the boot.

### Server authority

`WalletService` is the only component that may move coins or gems. It performs
the balance check and the write in a **single guarded `UPDATE`**, so two
concurrent spends cannot both pass a read-then-write check, and it appends
exactly one `CurrencyTransaction` row in the same transaction. Money-moving
calls accept an idempotency key; replaying one returns the recorded balance
instead of applying the change twice.

Verified live: a fresh account showed 5,000 coins and 50 gems backed by exactly
two ledger rows.

### Game data

`@empire/game-data` ships 22 buildings with generated level curves (226 levels),
7 units, 7 resources, 8 biome profiles, world geometry and 34 tuning values —
all seeded into the database and all editable from the admin panel.

Every definition points at art through an `asset` block rather than naming a
file, so replacing placeholder geometry with GLB models is a data edit.

### Client

React 19 + Three.js via React Three Fiber, rendering a deterministic terrain
from the same seeded noise the server will use for world generation. Instanced
scatter props (one draw call for ~60 trees), `AdaptiveDpr`/`AdaptiveEvents`, a
DPR ceiling of 1.75, and Three.js split into its own cache-stable chunk.

The HUD reads live server state. The side menu labels every screen with the
phase that makes it functional and visibly disables the ones that are not wired
up — nothing in the UI silently does nothing.

### Quality gates

ESLint 9 flat config across the monorepo, run with `--max-warnings=0`. The rule
set targets real defects — floating promises, unsafe `any` boundaries, missing
hook dependencies, post-await writes to shared state — rather than formatting,
which would only produce noise that trains people to ignore lint output.

Two test layers: 48 unit tests for pure logic, and a 34-test acceptance suite
that boots the real Nest application against the real PostgreSQL and Redis.
Nothing in the acceptance suite is mocked, so it fails if a guard is
misconfigured or a password is stored in a way bcrypt cannot verify.

### Admin

Its own container, its own image, served under `/admin/`. Dashboard aggregates,
a live game-configuration editor, and a system-health page. Config writes are
type-checked server-side and every one appends an `AuditLog` row with redacted
before/after values.

---

## Files created

```
docker-compose.yml  docker-compose.prod.yml  .env.example  .dockerignore
.gitignore  README.md

nginx/nginx.conf  nginx/conf.d/{dev,prod}.conf  nginx/includes/empire-routes.inc

packages/shared/       api, auth, enums, error-codes, events, health
packages/game-data/    types, resources, buildings, units, environment, config, world
packages/game-engine/  rng, grid, power, production (+ spec)
packages/ui/           primitives, theme.css, format

apps/api/
  Dockerfile  docker-entrypoint.sh  docker-entrypoint.dev.sh
  prisma/schema.prisma  prisma/seed.ts  prisma/migrations/00000000000000_init/
  src/  config, common, prisma, redis, logging, audit, mail, economy,
        game-config, health, auth, players, admin, realtime, main.ts

apps/web/
  Dockerfile  docker-entrypoint.dev.sh  nginx-spa.conf  vite.config.ts
  src/  lib/{api,socket}, store/{auth,empire}, game/{EmpireScene,PlaceholderMesh},
        ui/{Hud,SideMenu}, screens/{Auth,Game,VerifyEmail,ResetPassword}, App

apps/admin/
  Dockerfile  docker-entrypoint.dev.sh  nginx-spa.conf  vite.config.ts
  src/  lib/api, pages/{Dashboard,GameConfig,System}, App

scripts/backup-db.sh  scripts/restore-db.sh  scripts/postgres-init/01-extensions.sql
```

---

## Database changes

Initial migration `00000000000000_init` — 52 tables, 124 indexes, 34 enums, the
`citext` and `pg_trgm` extensions.

Seeded (idempotent, safe on every boot): 34 config keys, 7 resources, 22
building definitions with 226 levels, 7 unit definitions, 8 quests, 6
achievements, 4 payment packages, 1 bootstrap admin.

The seed **upserts** and deliberately does not overwrite config *values*, so a
balance change made in the admin panel survives the next deploy. Verified: a
`market.feeBps` override of 750 survived a full `down`/`up` cycle.

---

## Docker changes

Three multi-stage Dockerfiles, each with `development`, `build` and
`production` targets, built from the repo root so npm workspaces resolve.

Production images run as non-root — verified by resolving the runtime uid
inside each: api `1000/node`, web and admin `101/nginx`.

Each image installs only its own workspace (`npm ci --workspace @empire/x
--include-workspace-root`). A bare root install put ~170MB of browser-only
packages — three.js, mediapipe, hls.js — into the API image; scoping it cut the
production API image from 1.06GB to 826MB, and the web and admin images are
77–79MB.

---

## How to test

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps                      # expect six services, all healthy
docker compose logs backend | grep -A4 "BOOTSTRAP ADMIN"   # one-time password
```

| Check | Command / URL | Expected |
| ----- | ------------- | -------- |
| Liveness | `curl localhost/api/health` | `status: ok` |
| Readiness | `curl localhost/api/ready` | `ok`, both dependencies `ok` |
| Game client | http://localhost | Auth screen, then the 3D world |
| Admin panel | http://localhost/admin | Sign in as the bootstrap admin |
| API docs | http://localhost/docs | 21 documented paths |
| Register | `POST /api/v1/auth/register` | 201, empire provisioned |
| Role gate | player → `GET /api/v1/admin/overview` | 403 `INSUFFICIENT_ROLE` |
| Mass assignment | register with `"role":"SUPER_ADMIN"` | 400 `property role should not exist` |
| Refresh reuse | replay a rotated refresh token | 401 `REFRESH_TOKEN_REUSED` |
| Rate limit | 14 rapid logins | 401 ×6 then 429 |
| Websocket | `/socket.io/?EIO=4&transport=websocket` | HTTP 101 |
| Persistence | `docker compose down && up -d` | account, empire and config override intact |
| Backup | `./scripts/backup-db.sh` | dump written and readback-verified |
| Restore | delete a user, then `restore-db.sh` | user recovered |
| Unit tests | `docker compose exec backend npx jest` | 48 passing |
| Acceptance suite | `docker compose exec backend npm run test:e2e -w @empire/api` | 34 passing |
| Lint | `npm run lint` | clean at zero warnings |
| Typecheck | `npm run typecheck` | clean |

---

## Bugs found and fixed during verification

These were all caught by running the stack rather than by reading the code.

1. **Seeded admin had an empty password.** `SEED_ADMIN_PASSWORD=` is present but
   empty in `.env`, and `??` does not fall back on an empty string — so the
   admin was created by hashing `""` while the log printed a different,
   generated password. `bcrypt.compare("", hash)` returned `true`. Fixed with
   `|| undefined` plus a hard guard that refuses to create a privileged account
   with a password under 12 characters.
2. **No migration files.** The dev entrypoint bootstrapped with `db push`, so
   production's `migrate deploy` aborted with `P3005`. A real initial migration
   now ships, the dev entrypoint baselines an already-pushed database, and the
   production entrypoint refuses to start on an unknown schema state rather
   than falling back to `db push`.
3. **Redis healthcheck always failed.** The check expands `$REDIS_PASSWORD`
   inside the container, where it was never set, so it silently used the
   fallback and got `WRONGPASS`. The password is now passed through as an env
   var.
4. **Three ioredis clients shared one options object**, which ioredis mutates —
   `Redis is already connecting/connected` killed the boot. Each client now gets
   its own options, and connection is guarded by status.
5. **Instanced props all collapsed to the origin.** Matrices were written in
   `useMemo`, which runs during render before React attaches the ref. Moved to
   `useLayoutEffect`.
6. **A stale `vite.config.js`.** The web build script ran `tsc -b --noEmit
   false`, which emitted JavaScript next to every source file — including
   `vite.config.js`, which Vite prefers over the `.ts` version, so config edits
   silently did nothing. The build script no longer emits, and `.gitignore`
   guards against a recurrence.
7. **Client called an unimplemented endpoint.** `GET /land/me/home` is Phase 2;
   probing it produced repeated console 404s. The screen now derives the same
   answer from `empire.plotCount`, which the API already returns.
8. **Per-app `node_modules` copies broke the build.** npm workspaces hoist
   everything to the root; those paths do not exist.
9. **ESLint's autofix broke dependency injection.** `consistent-type-imports`
   rewrote NestJS constructor-injected imports to `import type`, which
   `emitDecoratorMetadata` erases at runtime — Nest would have failed to
   resolve any dependency. The API now enforces the *opposite* rule
   (`prefer: 'no-type-imports'`) so the footgun cannot come back.
10. **A post-await write to shared socket state.** `require-atomic-updates`
    flagged three separate field assignments to `client.data` after an await.
    Collapsed into one write so a half-populated identity is impossible.
11. **A hard-coded bcrypt hash in source.** The login timing-equaliser used a
    literal hash, which reads like a credential and pinned the cost factor.
    It is now generated once at boot from random bytes at the configured cost,
    memoising the *promise* so concurrent first-logins cannot race.

---

## Known limitations

Deliberate scope boundaries, not defects:

- **No world grid.** Regions, zones and plots are generated in Phase 2. New
  accounts receive an empire, garrison, treasury and inventory but no
  territory, and the game screen says so plainly. `PlayerBootstrapService`
  already contains the starter-plot claim logic and runs it lazily on every
  empire read, so accounts created now will pick up their plot automatically
  once the world exists.
- **Buildings are catalogue-only.** 22 definitions and 226 levels are seeded and
  the renderer can draw them, but placement, construction and upgrades are
  Phase 3, so no building instances are created yet.
- **`empirePower` is always 0.** The scoring function exists and is unit-tested;
  nothing recomputes it until there are buildings and armies to score.
- **Resources do not tick.** The accrual function is implemented and tested, but
  nothing calls it until production buildings exist in Phase 3.
- **SMTP is not wired.** `MAIL_DRIVER=log` writes verification and reset links to
  the API log. Setting `MAIL_DRIVER=smtp` throws rather than silently dropping
  account-recovery mail.
- **Payments are disabled.** `PAYMENT_PROVIDER=none`. Packages are seeded; the
  provider integration is Phase 7.
- **Socket.IO carries auth, rooms and notifications only.** Battle and chat
  handlers arrive in Phases 5 and 8.
- **TLS is commented out.** `nginx/conf.d/prod.conf` has the 443 block ready;
  drop certificates into `nginx/certs/` and uncomment.
- **Production API image is 826MB.** Prisma's engines account for ~190MB of
  that. Further trimming belongs to the Phase 10 optimisation pass.
- **Docker Desktop needs headroom.** This machine allots Docker 4GB, and an
  unrelated Kafka stack was already consuming ~700% CPU and ~880MB. That
  starved the backend build until the daemon crashed. Nothing to do with the
  project — but a 4GB Docker VM shared with other workloads will struggle
  during the first build. 6GB+ is comfortable.
- **`prisma.config.ts` migration pending.** Prisma 6 warns that
  `package.json#prisma` is deprecated in Prisma 7. Migrating was attempted and
  reverted: `prisma.config.ts` disables Prisma's own `.env` loading
  ("Prisma config detected, skipping environment variable loading"), which
  would break host-side `npx prisma migrate dev` for a developer with a `.env`
  file. Not worth invalidating a verified boot path to silence a cosmetic
  notice. Phase 10.

---

## Next: Phase 2

3D world, camera, world grid, starter plot.

1. A resumable world generator producing 64 regions → 4,096 zones → 65,536
   plots, with deterministic biomes and terrain from the seeded noise already
   in `@empire/game-engine`, and server-computed plot prices.
2. Land endpoints: `GET /land/me/home`, `GET /land/plots` (viewport query),
   `GET /land/plots/:code`.
3. Region-based streaming on the client so only the visible slice of the world
   is loaded.
4. Wire the starter-plot claim — the code already exists and is a no-op until a
   world row appears.
5. Replace the Phase 2 seam in `GameScreen.tsx` with the real fetch.
