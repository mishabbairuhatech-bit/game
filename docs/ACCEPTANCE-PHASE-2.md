# Phase 2 acceptance checklist

Every item verified against the running stack. The evidence column records what
was actually observed, not what was intended.

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Persistent world exists | PASS | `frontier`, seed `EMPIRE-001`, status `ACTIVE`, survives restart |
| 2 | World → Region → Zone → Plot hierarchy works | PASS | 100 / 2 500 / 10 000 rows; DB counts match the geometry; zero orphans; zero duplicate coordinates |
| 3 | Deterministic world generation works | PASS | Stored plots recomputed from the seed match plot-for-plot; two generations of one seed are identical; a different seed differs |
| 4 | Terrain/biome generation works | PASS | 11 biomes present in coherent bands — grassland 3 487, water 1 944, forest 1 290, riverland 998, lakeshore 834, badlands 477, desert 419, tundra 255, rocky 144, highland 99, swamp 53 |
| 5 | Plot states work | PASS | All 8 states in the schema; transition table with reason guards; `UNAVAILABLE` terminal |
| 6 | New users receive unique starter territory | PASS | 5 concurrent registrations → 5 distinct plots, no collisions |
| 7 | Starter territory survives restart | PASS | Verified across `docker compose down` + `up` |
| 8 | Ownership is persisted | PASS | `plots.owner_id` plus an append-only `plot_ownerships` trail |
| 9 | Ownership race conditions are prevented | PASS | Guarded `UPDATE ... WHERE status='FREE' AND owner_id IS NULL` inside a serializable transaction |
| 10 | World APIs work | PASS | 11 endpoints; 200s and correct 400/404s |
| 11 | Viewport-based map queries work | PASS | Bounds mandatory; a 10 000-plot request is clamped to 2 500 with `truncated: true` |
| 12 | Player territory API works | PASS | Holdings, camera bounds, home plot, expansion eligibility |
| 13 | Plot detail API works | PASS | Resolves by UUID and by code; server-computed `actions` |
| 14 | FREE plot purchase works | PASS | Claimed in the browser: 3 250 coins, `FREE → OWNED` |
| 15 | Coins are deducted through the ledger | PASS | `PLOT_PURCHASE_WORLD -3250 → 1750`; ledger sum equals the wallet; `plot_ownerships.transaction_id` links to it |
| 16 | 3D map renders | PASS | 2 500 plots as one instanced mesh, coherent terrain |
| 17 | Map camera works | PASS | Pan, zoom, orbit, touch, animated flights, reset |
| 18 | Plot selection works | PASS | Click → detail panel with terrain, owner, price, actions |
| 19 | My Empire navigation works | PASS | Flies the camera to the starter holding |
| 20 | Region/chunk loading works | PASS | Viewport streaming with padding, cache eviction, region LOD above the distance threshold |
| 21 | No critical client console errors | PASS | 0 errors, 0 warnings on load and after sign-in |
| 22 | TypeScript passes | PASS | `npm run typecheck` clean across all workspaces |
| 23 | ESLint passes | PASS | `npm run lint` (`--max-warnings=0`) clean |
| 24 | All Phase 1 tests still pass | PASS | 48 unit + 32 acceptance + 2 rate-limit, unchanged |
| 25 | New Phase 2 tests pass | PASS | 51 unit + 43 integration (176 cases total across the project) |
| 26 | Docker stack remains healthy | PASS | All six services healthy |
| 27 | README is updated | PASS | New "The world" section, updated performance, accessibility, layout and phase table |

## Security checks

| Check | Result |
| ----- | ------ |
| Client-supplied `price` / `ownerId` rejected | PASS — `forbidNonWhitelisted` returns `VALIDATION_ERROR`, nothing moves |
| Purchase requires authentication | PASS — 401 |
| Non-adjacent purchase refused | PASS — `PLOT_NOT_ADJACENT` |
| Unclaimable ground refused | PASS — 400 `PLOT_NOT_AVAILABLE` |
| Another player's plot refused | PASS — 409 `PLOT_NOT_AVAILABLE` |
| Insufficient coins refused, nothing moves | PASS — wallet and plot both unchanged |
| Purchase cooldown enforced | PASS — `PLOT_PURCHASE_COOLDOWN` |
| Owner ids never leaked by the map | PASS — only public display names |
| Viewport cannot request the whole world | PASS — clamped server-side |

## End-to-end round trip

The full chain the phase brief requires, exercised in the browser:

```
DATABASE → BACKEND → API → FRONTEND → 3D MAP → USER INTERACTION → DATABASE
```

Searched `52,54` → jumped the camera → clicked the plot → panel showed
`UNCLAIMED`, grassland, 3 250 coins → clicked Claim → panel became `CLAIMED`,
owner `FinalCheck`, Buy replaced by "You already hold this plot" → territory
counter went 1/12 → 2/12 → PostgreSQL confirmed the plot, the ledger row and
the ownership row with its transaction link.
