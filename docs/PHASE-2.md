# Phase 2 — The persistent world

World generator, region/zone/plot hierarchy, starter territory, map APIs, land
expansion, and the 3D world map.

Verified end to end against the running stack: database → backend → API →
frontend → 3D map → user interaction → database persistence. A plot was claimed
by clicking it in the browser, and the coins, ownership row and ledger entry
were confirmed in PostgreSQL afterwards.

---

## What was implemented

### World generation

Terrain is a pure function of `(seed, coordinates)`. Three noise fields —
elevation, moisture, temperature — plus a ridged river field are layered and
read into a biome, so mountains form ranges and water forms lakes rather than a
confetti of unrelated tiles. An edge falloff pulls elevation down near the
boundary, making the world read as an island instead of terrain sliced off by
the map edge.

Only the seed is persisted. Sub-plot detail is recomputed on demand, which is
why a region streams in kilobytes rather than megabytes.

The development world is **1000×1000 tiles** → 100 regions, 2 500 zones,
10 000 plots, generated in **~4 seconds**. Every size is configurable
(`world.*` in the admin panel) and validated at generation time: the tiers must
divide evenly, because partial regions at the edge would break coordinate maths
everywhere downstream.

Observed biome mix on seed `EMPIRE-001`: grassland 3 487, water 1 944, forest
1 290, riverland 998, lakeshore 834, badlands 477, desert 419, tundra 255,
rocky 144, highland 99, swamp 53 — 8 056 claimable plots.

### Terrain rules

All twelve biomes have one rule each in `@empire/game-data/terrain`, covering
buildability, traversability, price modifier, yield bonus, colour, glyph and
fill pattern. The renderer and the server read the same table — a client that
disagrees with the server about which ground is buildable is a bug the player
sees.

Water and mountain generate as `UNAVAILABLE`, a terminal state in the plot
lifecycle: they are scenery, not inventory, and can never be claimed or sold.

### Plot lifecycle

Every status change goes through one transition table with reason guards, so an
illegal transition is impossible to express rather than merely unlikely. The
notable refusals are deliberate: the world does not list its own land
(`FREE → FOR_SALE`), and a player cannot sell the ground their keep stands on
(`STARTER → FOR_SALE`).

### Starter territory

Granted inside the same transaction as the rest of account provisioning — an
empire with no land is a player who cannot play. Allocation draws from a
bounded pool of eligible plots (starter biome, ≤15 % water, away from the world
edge) in pseudo-random order, then filters for a minimum distance from every
existing holding, so players spread out rather than pile up. If the world is
crowded the distance rule relaxes rather than refusing to admit anyone.

Two simultaneous signups cannot be handed the same ground: the claim is a
guarded `UPDATE ... WHERE status='FREE' AND owner_id IS NULL`, so the loser
matches zero rows and moves to the next candidate. Verified with five
concurrent registrations.

The starter base (8 buildings) is laid out for the configured plot size and
guarded at runtime — a building that would hang off the edge is skipped and
logged rather than persisted outside the plot.

### Map API

Eleven endpoints (listed in the README). The important property is that
**viewport bounds are mandatory and clamped** — to the world, and to 2 500
plots — before the query runs. No request, however crafted, can pull the whole
world into one response; a narrowed response sets `truncated: true` so the
client falls back to region summaries instead of silently showing partial data.

Map reads use *optional* authentication: anyone may look at the world, and a
signed-in caller additionally sees which plots are theirs and what they may do.
The `actions` block is computed server-side, so the UI can never offer a button
the API would refuse.

### Land expansion

The request carries only a plot id. Price, adjacency, plot limit, HQ level,
cooldown and the coin debit are all resolved server-side inside one
`SERIALIZABLE` transaction; the transfer is a guarded update, so two
simultaneous buyers cannot both succeed. Every purchase appends a
`CurrencyTransaction` and a `PlotOwnership` row linked by `transactionId`, so
land and money reconcile against each other.

Purchase failures distinguish two situations by status code, which a client can
act on: **400** means this ground can never be bought (terminal state), **409**
means it is not available right now (held, locked, event) and the state may
change.

### 3D map

Up to 2 500 plots render as a **single instanced mesh**. Above a camera-distance
threshold the plot layer is swapped for a region layer (100 instances for the
whole world) and streaming stops entirely. Camera supports pan, zoom, orbit and
touch (one finger pans, two pinch-zoom and rotate), with animated flights to a
target driven from the store so any part of the UI can move the camera.

Plot status is encoded three ways — colour, height and edge — plus a glyph in
the legend and a text label in the panel, so the map is readable without
relying on hue.

### Frontend state

Six focused stores rather than one: `world` (static geometry), `map`
(viewport + streamed tiles + camera), `plot` (selection + purchase),
`territory` (holdings), `empire`, `auth`. The world's geometry changes once, at
generation; the camera changes sixty times a second — putting both in one store
would re-render every geometry consumer on each pan.

---

## Files changed

**New**

```
packages/game-data/src/terrain.ts            twelve biome rules
packages/game-data/src/world.spec.ts
packages/game-engine/src/worldgen.ts         deterministic generator
packages/game-engine/src/plot-state.ts       transition table
packages/game-engine/src/worldgen.spec.ts

apps/api/src/world/
  world-generator.service.ts                 world/region/zone/plot generation
  world.service.ts                           map queries, viewport, search
  territory.service.ts                       starter allocation, purchase
  world.controller.ts  territory.controller.ts  dto/world.dto.ts  world.module.ts
apps/api/prisma/migrations/20260914120000_phase2_world_grid/
apps/api/test/phase2.e2e-spec.ts

apps/web/src/game/map/
  WorldMapScene.tsx  PlotLayer.tsx  RegionLayer.tsx  plotAppearance.ts
apps/web/src/ui/map/  PlotPanel.tsx  MapControls.tsx
apps/web/src/screens/MapScreen.tsx
apps/web/src/store/  world.store.ts  map.store.ts  plot.store.ts  territory.store.ts
```

**Modified** — `packages/shared/src/enums.ts` (4 new biomes, `WorldStatus`),
`packages/game-data/src/{world,environment,config,index}.ts`,
`packages/game-engine/src/index.ts`, `apps/api/prisma/{schema.prisma,seed.ts}`,
`apps/api/src/{app.module,main}.ts`,
`apps/api/src/common/decorators/index.ts` (`@OptionalAuth`),
`apps/api/src/auth/guards/jwt-auth.guard.ts`,
`apps/api/src/players/{players.module,player-bootstrap.service}.ts`,
`apps/web/src/screens/GameScreen.tsx`, `apps/web/src/ui/SideMenu.tsx`,
`apps/web/src/game/EmpireScene.tsx`, `README.md`.

---

## Database changes

Migration `20260914120000_phase2_world_grid`:

- `Biome` gains `WATER`, `DESERT`, `SWAMP`, `ROCKY` (12 total)
- new `WorldStatus` enum
- `World`: tile-based geometry (`width`, `height`, `regionSize`, `zoneSize`,
  `plotSize`), `status`, `generatedAt`; the old region-count columns are dropped
- `Region` / `Zone`: `width`, `height`, `seed`, `tileX`, `tileY`
- `Plot`: `tileX`, `tileY`, `isBuildable`, `protectedUntil`
- `PlotOwnership`: `empireId`, `previousOwnerId`, `transactionId` — the full
  transfer trail the marketplace will need
- new unique constraints `zones(regionId,x,y)` and `plots(zoneId,x,y)`, plus
  viewport indexes on `plots(worldId,x,y,status)` and
  `plots(worldId,status,isBuildable)`

`NOT NULL` columns are added with a temporary default that is then dropped, so
the migration also works on a database that already holds world rows.

A second migration, `20260914140000_plot_code_scoped_to_world`, replaces the
global unique on `plots.code` with `@@unique([worldId, code])` — see bug 10
below.

Seeded data: the world itself (100 regions, 2 500 zones, 10 000 plots) plus 9
new config keys under `world.*` and `starter.*`.

---

## APIs added

| Method | Path | Auth |
| ------ | ---- | ---- |
| GET | `/api/v1/world` | public |
| GET | `/api/v1/world/regions` | public |
| GET | `/api/v1/world/regions/:id` | public |
| GET | `/api/v1/world/regions/:id/zones` | public |
| GET | `/api/v1/world/zones/:id` | public |
| GET | `/api/v1/world/plots` | optional |
| GET | `/api/v1/world/search` | optional |
| GET | `/api/v1/plots/:idOrCode` | optional |
| GET | `/api/v1/player/territory` | required |
| GET | `/api/v1/player/territory/nearby` | required |
| POST | `/api/v1/player/territory/purchase` | required |

---

## Docker changes

None. The existing stack, images and healthchecks are unchanged; Phase 2 is
schema, code and data only.

---

## Tests

Counts are as jest reports them — `it.each` blocks expand to one case per row,
so they exceed the number of `it(...)` declarations in the files.

| Suite | Cases |
| ----- | ----- |
| Unit — errors, auth policy, engine (Phase 1) | 48 |
| Unit — worldgen, plot state, geometry, terrain (Phase 2) | 51 |
| **Unit total** | **99** |
| Integration — Phase 1 acceptance | 32 |
| Integration — rate limiting | 2 |
| Integration — Phase 2 acceptance | 43 |
| **Integration total** | **77** |
| **All** | **176** |

The Phase 2 integration suite covers world creation, hierarchy counts, duplicate
coordinates, parent correctness, deterministic generation (both by recomputing
terrain from the seed and by generating two small worlds and diffing them),
viewport bounds and the 2 500-plot cap, filters, owner-id leakage, plot detail
by id and code, starter assignment, **five concurrent registrations**,
idempotency, the purchase happy path, ledger reconciliation, and eight refusal
cases.

---

## Bugs found and fixed during verification

1. **Instanced meshes rendered black.** `vertexColors` on the material makes
   the shader read a per-vertex `color` attribute from the geometry, which a
   `BoxGeometry` does not have. Instance colours come from `instanceColor` and
   must not be combined with it.
2. **Region slabs swallowed the plots.** Both LOD layers were drawn together; a
   region slab is 10 units across and taller than an unclaimed plot, so only
   raised owned plots showed through. The layers are now mutually exclusive.
3. **Viewport queries took 5.4 s.** The default Prisma projection pulls every
   column including the per-plot `terrain` JSON — for 2 500 rows that is a
   multi-second serialisation job the map never reads. Narrowing to the eight
   fields `PlotSummary` needs brought it to **0.28 s**.
4. **`@Public()` broke ownership display.** It short-circuits the auth guard, so
   `@CurrentUser()` stayed undefined and a signed-in player was told to "sign in
   to claim land" on their own plot. Added `@OptionalAuth()`: runs the strategy,
   identifies the caller when a token is present, tolerates anonymity.
5. **The expansion shortlist offered plots the API would refuse.** `nearby`
   returned a square ring including diagonals; the purchase check requires
   orthogonal adjacency. That is a Buy button that fails — the shortlist now
   matches the rule exactly, and a test asserts it.
6. **Expansion was unreachable.** `land.minHqLevelToExpand` defaulted to 3, but
   HQ upgrades do not exist until Phase 3, so the whole purchase system was dead
   code. Lowered to 1; raise it from the admin panel once upgrades ship.
7. **Migration ordering bug.** The plots backfill read `worlds.plot_size` before
   that column was added. Caught by the migration failing loudly rather than
   half-applying — Prisma wraps each file in a transaction, so it rolled back.
8. **The starter layout assumed 16×16 plots.** Phase 2 plots are 10×10, so
   buildings would have been placed off the edge. Relaid out for 10×10
   (69/100 tiles, verified non-overlapping) and guarded at runtime against any
   configured size.
9. **Inconsistent purchase status codes.** "Unavailable" returned 400 while
   "owned by someone else" returned 409, with the same error code. Now
   principled: 400 = can never be bought, 409 = not available right now.
10. **A second world could never be generated — silently.** `plots.code` carried
    a *global* unique constraint, but a plot code is derived from coordinates,
    so every world produces exactly the same set of codes. With
    `createMany(skipDuplicates: true)` the colliding rows were discarded and
    generation reported success: the second world was created with almost no
    plots and no error anywhere. Fixed by scoping the constraint to
    `@@unique([worldId, code])`.

    The silence was the worse half of the bug, so the generator now counts the
    rows it actually inserted and throws if any were dropped, and the
    generation report returns database counts rather than echoing the
    arithmetic. A report derived only from the geometry cannot detect a partial
    write.

    Found by a test assertion that two *different* seeds must produce different
    terrain. The corresponding positive assertion — that two runs of the *same*
    seed match — had been passing vacuously, because a join that matches
    nothing returns zero differences either way.

---

## Known limitations

Deliberate scope boundaries, not defects:

- **No building placement.** Plots report `isBuildable` and the starter base is
  placed, but players cannot yet add or move buildings — that is Phase 3. The
  empire view renders terrain only.
- **`empirePower` is still 0.** The scoring function is implemented and tested;
  nothing recomputes it until buildings and armies are live.
- **Resources do not tick.** The accrual function is tested but not yet driven.
- **No player-to-player land sales.** `FOR_SALE` exists in the state machine and
  the transition is tested, but listing and buying from another player is
  Phase 6. The plot panel says so rather than offering a dead button.
- **Region streaming is viewport-based, not chunk-cached.** The client streams
  the visible rectangle and evicts beyond 12 000 cached tiles. It does not
  pre-fetch neighbouring regions in the background; on a fast pan there is a
  brief gap before new tiles arrive.
- **World generation is synchronous.** 10 000 plots takes ~4 s, which is fine at
  this size. A 4000-tile world (160 000 plots) would need the generation moved
  to a job with progress reporting.
- **The camera does not persist between sessions.** Re-entering the map always
  frames the player's home.
- **`prisma.config.ts` migration still pending** — unchanged from Phase 1, and
  documented there.

---

## Next: Phase 3

Buildings, 3D placement, resources, upgrades.

1. Building placement API with server-side validation against the plot's
   footprint, terrain buildability and existing structures — `rectsOverlap` and
   `rectContains` in `@empire/game-engine` already exist for it.
2. The 3D placement editor: preview, move, rotate, green/red validity, all
   re-validated server-side on confirm.
3. Resource production driven by the tested `accrue()` function, anchored on
   `Empire.lastAccrualAt`.
4. Construction and upgrade queues, with costs snapshotted at start so a
   balance change cannot retroactively alter work already paid for.
5. Recompute `empirePower` as buildings land, which lights up the leaderboard
   and matchmaking inputs.
6. Raise `land.minHqLevelToExpand` once upgrades exist.
