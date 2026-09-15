# Phase 1 acceptance checklist

Every item verified against the running stack. Commands are reproducible; the
evidence column records what was actually observed, not what was intended.

## Docker

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | `docker compose up -d --build` completes | PASS | Full rebuild from wiped volumes and deleted images |
| 2 | All containers `healthy` in `docker compose ps` | PASS | nginx, frontend, backend, admin, postgres, redis |
| 3 | `docker compose down` shuts down cleanly | PASS | All containers and the network removed, volumes kept |
| 4 | PostgreSQL data persists across restart | PASS | Account, empire and an admin config override all survived `down` + `up` |
| 5 | Redis reachable by the backend | PASS | `/api/ready` reports `redis: ok` with latency |

## Frontend

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 6 | `http://localhost` loads | PASS | HTTP 200, `<title>Empire Frontier</title>` |
| 7 | Renders without console-breaking errors | PASS | 0 errors and 0 warnings, cold load and after sign-in |
| 8 | Talks to the backend through NGINX | PASS | HUD renders live coins/gems/resources from `/api/v1/players/me/empire` |

## Backend

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 9 | Starts inside Docker | PASS | `listening on :4000 [development] prefix=/api/v1` |
| 10 | `GET /api/health` succeeds | PASS | `{"status":"ok","service":"empire-frontier-api",...}` |
| 11 | Connects to PostgreSQL | PASS | `connected to postgres`; `/api/ready` reports db ok |
| 12 | Connects to Redis | PASS | `connected to redis`; `/api/ready` reports redis ok |
| 13 | Structured JSON errors | PASS | Every failure is `{success:false,error:{code,message,requestId,timestamp}}` |

## Authentication

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 14 | Registration works | PASS | 201 + a fully provisioned empire, army, wallet and inventory |
| 15 | Login works | PASS | 200 + bearer token + httpOnly refresh cookie |
| 16 | Passwords securely hashed | PASS | `$2b$12$…`; plaintext absent; `bcrypt.compare('')` false |
| 17 | Protected routes reject unauthenticated requests | PASS | 401 `UNAUTHENTICATED` on 4 protected routes |
| 18 | Logout / session invalidation works | PASS | Revoked cookie cannot refresh; `logout-all` kills live access tokens |

## Database

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 19 | Prisma schema valid | PASS | `prisma validate` |
| 20 | Migrations run | PASS | `00000000000000_init` applied to an empty database |
| 21 | Seed runs | PASS | 34 config keys, 22 buildings/226 levels, 7 units, quests, achievements, admin |
| 22 | User/profile records create and retrieve | PASS | Verified through the API and directly in the database |

## NGINX

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 23 | `/` routes to the frontend | PASS | HTTP 200, game client HTML |
| 24 | `/api/` routes to the backend | PASS | 21 documented paths reachable |
| 25 | WebSocket proxy present and validated | PASS | Socket.IO handshake returns a sid; upgrade returns **HTTP 101** |
| 26 | PostgreSQL and Redis not publicly exposed | PASS | Dev binds `127.0.0.1` only; prod publishes nothing |

## Admin

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 27 | Loads through `/admin` | PASS | HTTP 200, dashboard renders live aggregates |
| 28 | Authn/authz foundation exists | PASS | Staff sign-in; role gate; audited config writes |
| 29 | PLAYER cannot reach ADMIN endpoints | PASS | 403 `INSUFFICIENT_ROLE` on every admin route, read and write |

## Quality

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 30 | TypeScript compilation passes | PASS | `npm run typecheck` clean across all workspaces |
| 31 | Linting passes | PASS | `npm run lint` (`eslint . --max-warnings=0`) clean |
| 32 | Automated Phase 1 tests pass | PASS | 48 unit + 34 acceptance = **82 passing** |
| 33 | No hardcoded production secrets | PASS | Scan clean; the one literal hash is now generated at boot |
| 34 | `.env` excluded from Git | PASS | `git check-ignore` confirms; not in the 157 tracked files |
| 35 | README complete | PASS | Setup, startup, shutdown, migration, seed, backup, troubleshooting |

## Final smoke test

```bash
git clone <repository> && cd empire-frontier
cp .env.example .env
docker compose up -d --build
```

| URL | Result |
|-----|--------|
| http://localhost | Game client |
| http://localhost/admin | Admin panel |
| http://localhost/api/health | `{"status":"ok",...}` |

---

## Issues found and fixed while working the checklist

1. **`GET /api/health` did not exist.** Health was mounted at the root only.
   Both probes now live under `/api`, version-neutral so the container
   healthcheck URL cannot drift; NGINX aliases the bare `/health` and `/ready`
   for uptime monitors. Container healthchecks were repointed to match.
2. **No linter at all.** Added ESLint 9 flat config for the whole monorepo,
   enforced at zero warnings.
3. **ESLint's own autofix broke dependency injection.** It rewrote NestJS
   constructor imports to `import type`, which `emitDecoratorMetadata` erases —
   Nest would have failed to resolve every dependency at runtime. Reverted, and
   the API now enforces the opposite rule so it cannot recur.
4. **Three post-await writes to shared socket state** in the realtime gateway,
   collapsed into a single assignment.
5. **A hard-coded bcrypt hash in source** (the login timing equaliser). Now
   generated at boot from random bytes at the configured cost, memoising the
   promise so concurrent first-logins cannot race.
6. **A reassignment-after-await** in the empire read path, restructured.
7. **Dead code** — an unused import and a pointless re-export that also
   disabled fast refresh for the whole game screen.
8. **No integration tests.** Added a 34-test acceptance suite that boots the
   real application against the real PostgreSQL and Redis, plus a separate
   suite that exercises the rate limiter with the guard intact.
9. **Not a Git repository.** Initialised, with `.env` exclusion verified.
10. **A 401 on every cold page load.** The refresh cookie is `httpOnly`, so the
    client could not tell whether a session existed and had to fire a
    speculative `/auth/refresh` — which a first-time visitor always saw fail.
    The API now sets a readable companion flag next to it. The flag carries no
    secret and grants nothing; forging it only buys one 401, because the server
    still validates the real cookie. Console is now clean on a cold load, and
    logged-out visitors save a round trip.
11. **A duplicate `wasm` mime type** in `nginx.conf`, warned on every startup.
    Both configs now pass `nginx -t` cleanly, verified against stub upstreams.
12. **The health-probe log filter still matched the old paths.** After moving
    the probes under `/api`, every 15-second container healthcheck would have
    been logged, burying real traffic.
