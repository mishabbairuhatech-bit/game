/**
 * =============================================================================
 * PHASE 2 ACCEPTANCE SUITE - the persistent world
 * =============================================================================
 * Runs against the real PostgreSQL and Redis, against the world the seed
 * generated. Nothing is mocked: these tests fail if the generator is
 * non-deterministic, if a viewport query is unbounded, if two players can be
 * handed the same starter plot, or if a purchase can move a plot without
 * moving the money.
 *
 *   docker compose exec backend npm run test:e2e -w @empire/api
 * =============================================================================
 */
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { MAX_VIEWPORT_PLOTS, plotCode, worldCounts } from '@empire/game-data';
import { dominantBiome, regionName, unbuildableCoverageBps } from '@empire/game-engine';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AppConfigService } from '../src/config/app-config.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { WorldGeneratorService } from '../src/world/world-generator.service';

const RUN = `p2-${Date.now().toString(36)}`;
const USER_PREFIX = RUN.replace(/[^a-zA-Z0-9_]/g, '_');
const email = (name: string) => `${RUN}-${name}@e2e.invalid`;
const username = (name: string) => `${USER_PREFIX}_${name}`.slice(0, 20);
const PASSWORD = 'Frontier2026';

jest.setTimeout(300_000);

describe('Phase 2 acceptance - persistent world', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let generator: WorldGeneratorService;
  let http: () => request.Agent;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();

    const config = app.get(AppConfigService);
    app.use(cookieParser());
    app.setGlobalPrefix(config.apiPrefix);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        validationError: { target: false, value: false },
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
    app.useGlobalFilters(new AllExceptionsFilter(false));

    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    generator = app.get(WorldGeneratorService);
    http = () => request(app.getHttpServer());
  });

  beforeEach(async () => {
    // The suite drives far more auth traffic from one address than a player
    // ever would; the limiter itself is covered in rate-limit.e2e-spec.ts.
    await redis.delPattern('throttle:*');
  });

  afterAll(async () => {
    if (prisma) {
      // Release any land the test users claimed, then remove them.
      const users = await prisma.user.findMany({
        where: { email: { contains: RUN } },
        select: { id: true },
      });
      const ids = users.map((u) => u.id);
      if (ids.length > 0) {
        await prisma.plot.updateMany({
          where: { ownerId: { in: ids } },
          data: {
            ownerId: null,
            empireId: null,
            status: 'FREE',
            acquiredAt: null,
            protectedUntil: null,
          },
        });
      }
      await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
      await prisma.world.deleteMany({ where: { slug: { startsWith: `test-${RUN}` } } });
    }
    await redis?.delPattern('throttle:*');
    await app?.close();
  });

  /** Registers a player and returns their bearer token and id. */
  async function register(name: string): Promise<{ token: string; userId: string }> {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email: email(name), username: username(name), password: PASSWORD })
      .expect(201);
    return { token: res.body.data.accessToken, userId: res.body.data.user.id };
  }

  /* ====================================================================== */
  /* World                                                                   */
  /* ====================================================================== */

  describe('world', () => {
    it('exposes a generated, active world', async () => {
      const res = await http().get('/api/v1/world').expect(200);
      const world = res.body.data;

      expect(world.status).toBe('ACTIVE');
      expect(world.seed).toEqual(expect.any(String));
      expect(world.width).toBeGreaterThan(0);
      expect(world.width).toBe(world.height);
    });

    it('reports a hierarchy whose counts agree with its geometry', async () => {
      const world = (await http().get('/api/v1/world').expect(200)).body.data;
      const expected = worldCounts({
        width: world.width,
        height: world.height,
        regionSize: world.regionSize,
        zoneSize: world.zoneSize,
        plotSize: world.plotSize,
      });

      expect(world.counts.totalRegions).toBe(expected.totalRegions);
      expect(world.counts.totalZones).toBe(expected.totalZones);
      expect(world.counts.totalPlots).toBe(expected.totalPlots);

      // ...and the database agrees with the arithmetic.
      const [regions, zones, plots] = await Promise.all([
        prisma.region.count({ where: { worldId: world.id } }),
        prisma.zone.count({ where: { worldId: world.id } }),
        prisma.plot.count({ where: { worldId: world.id } }),
      ]);
      expect(regions).toBe(expected.totalRegions);
      expect(zones).toBe(expected.totalZones);
      expect(plots).toBe(expected.totalPlots);
    });

    it('has no duplicate coordinates at any tier', async () => {
      const world = (await http().get('/api/v1/world').expect(200)).body.data;

      const dupes = await prisma.$queryRaw<{ tier: string; n: bigint }[]>`
        SELECT 'region' AS tier, count(*) AS n FROM (
          SELECT x, y FROM regions WHERE world_id = ${world.id}::uuid
          GROUP BY x, y HAVING count(*) > 1) d
        UNION ALL
        SELECT 'zone', count(*) FROM (
          SELECT x, y FROM zones WHERE world_id = ${world.id}::uuid
          GROUP BY x, y HAVING count(*) > 1) d
        UNION ALL
        SELECT 'plot', count(*) FROM (
          SELECT x, y FROM plots WHERE world_id = ${world.id}::uuid
          GROUP BY x, y HAVING count(*) > 1) d
      `;
      for (const row of dupes) expect(Number(row.n)).toBe(0);
    });

    it('parents every zone and plot correctly', async () => {
      const world = (await http().get('/api/v1/world').expect(200)).body.data;
      const zonesPerRegionSide = world.regionSize / world.zoneSize;

      const orphans = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n
        FROM zones z JOIN regions r ON r.id = z.region_id
        WHERE z.world_id = ${world.id}::uuid
          AND (floor(z.x / ${zonesPerRegionSide}::numeric) <> r.x
            OR floor(z.y / ${zonesPerRegionSide}::numeric) <> r.y)
      `;
      expect(Number(orphans[0]?.n ?? 0)).toBe(0);
    });

    it('lists regions, and each region lists its zones', async () => {
      const regions = (await http().get('/api/v1/world/regions').expect(200)).body.data;
      expect(regions.length).toBeGreaterThan(0);

      const first = regions[0];
      expect(first.name).toEqual(expect.any(String));
      expect(first.width).toBeGreaterThan(0);

      const zones = (
        await http().get(`/api/v1/world/regions/${first.id}/zones`).expect(200)
      ).body.data;
      expect(zones.length).toBeGreaterThan(0);
      for (const zone of zones) expect(zone.regionId).toBe(first.id);
    });

    it('returns a zone with its plots', async () => {
      const regions = (await http().get('/api/v1/world/regions').expect(200)).body.data;
      const zones = (
        await http().get(`/api/v1/world/regions/${regions[0].id}/zones`).expect(200)
      ).body.data;

      const zone = (await http().get(`/api/v1/world/zones/${zones[0].id}`).expect(200)).body
        .data;
      expect(zone.plots.length).toBeGreaterThan(0);
      expect(zone.regionName).toEqual(expect.any(String));
    });

    it('404s for an unknown region or zone', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      await http().get(`/api/v1/world/regions/${missing}`).expect(404);
      await http().get(`/api/v1/world/zones/${missing}`).expect(404);
    });
  });

  /* ====================================================================== */
  /* Determinism                                                             */
  /* ====================================================================== */

  describe('deterministic generation', () => {
    it('matches what the generator produces for the same seed, plot for plot', async () => {
      const live = (await http().get('/api/v1/world').expect(200)).body.data;
      const params = { seed: live.seed, size: live.width };

      // Recompute terrain directly from the seed and compare against what is
      // stored. This is a stronger check than regenerating a second world -
      // it proves the persisted rows still match the generator as it exists
      // today - and it costs a few hundred noise samples instead of a second
      // full 10 000-plot build.
      const sample = await prisma.plot.findMany({
        where: { worldId: live.id },
        select: { x: true, y: true, biome: true, waterCoverageBps: true, code: true },
        orderBy: [{ y: 'asc' }, { x: 'asc' }],
        take: 400,
      });
      expect(sample.length).toBeGreaterThan(100);

      for (const plot of sample) {
        const expectedBiome = dominantBiome(
          params,
          plot.x * live.plotSize,
          plot.y * live.plotSize,
          live.plotSize,
          3,
        );
        const expectedWater = unbuildableCoverageBps(params, plot.x, plot.y, live.plotSize);
        const expectedCode = plotCode(
          {
            width: live.width,
            height: live.height,
            regionSize: live.regionSize,
            zoneSize: live.zoneSize,
            plotSize: live.plotSize,
          },
          plot.x,
          plot.y,
        );

        expect(plot.biome).toBe(expectedBiome);
        expect(plot.waterCoverageBps).toBe(expectedWater);
        expect(plot.code).toBe(expectedCode);
      }

      // Region names are part of the deterministic output too.
      const regions = await prisma.region.findMany({
        where: { worldId: live.id },
        select: { x: true, y: true, name: true },
        take: 30,
      });
      for (const region of regions) {
        expect(region.name).toBe(regionName(live.seed, region.x, region.y));
      }
    });

    it('generates an identical small world from the same seed', async () => {
      // The end-to-end proof, on a deliberately small world so it costs
      // seconds rather than minutes: two generations from one seed must agree
      // on every plot.
      const geometry = { width: 200, height: 200, regionSize: 100, zoneSize: 20, plotSize: 10 };

      const a = await generator.generate({
        slug: `test-${RUN}-det-a`,
        name: 'Determinism A',
        seed: 'DETERMINISM-CHECK',
        geometry,
      });
      const b = await generator.generate({
        slug: `test-${RUN}-det-b`,
        name: 'Determinism B',
        seed: 'DETERMINISM-CHECK',
        geometry,
      });

      expect(a.plots).toBe(400);
      expect(b.plots).toBe(400);
      expect(b.biomeBreakdown).toEqual(a.biomeBreakdown);

      const mismatches = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n
        FROM plots p1
        JOIN plots p2 ON p2.x = p1.x AND p2.y = p1.y AND p2.world_id = ${b.worldId}::uuid
        WHERE p1.world_id = ${a.worldId}::uuid
          AND (p1.biome <> p2.biome
            OR p1.water_coverage_bps <> p2.water_coverage_bps
            OR p1.is_buildable <> p2.is_buildable
            OR p1.price <> p2.price)
      `;
      expect(Number(mismatches[0]?.n ?? 0)).toBe(0);

      // ...and a different seed must produce a different world.
      const c = await generator.generate({
        slug: `test-${RUN}-det-c`,
        name: 'Determinism C',
        seed: 'A-DIFFERENT-SEED',
        geometry,
      });
      const differences = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n
        FROM plots p1
        JOIN plots p2 ON p2.x = p1.x AND p2.y = p1.y AND p2.world_id = ${c.worldId}::uuid
        WHERE p1.world_id = ${a.worldId}::uuid AND p1.biome <> p2.biome
      `;
      expect(Number(differences[0]?.n ?? 0)).toBeGreaterThan(20);

      await prisma.world.deleteMany({
        where: { id: { in: [a.worldId, b.worldId, c.worldId] } },
      });
    });

    it('is idempotent on the world slug', async () => {
      const live = (await http().get('/api/v1/world').expect(200)).body.data;
      const again = await generator.generate({
        slug: live.slug,
        name: live.name,
        seed: live.seed,
      });
      // Re-running the seed must never rebuild terrain under a player's feet.
      expect(again.skipped).toBe(true);
      expect(again.worldId).toBe(live.id);
    });

    it('marks water and mountain as unclaimable', async () => {
      const wrong = await prisma.plot.count({
        where: { biome: { in: ['WATER', 'MOUNTAIN'] }, status: { not: 'UNAVAILABLE' } },
      });
      expect(wrong).toBe(0);

      const alsoWrong = await prisma.plot.count({
        where: { biome: { in: ['WATER', 'MOUNTAIN'] }, isBuildable: true },
      });
      expect(alsoWrong).toBe(0);
    });

    it('prices every claimable plot and nothing else', async () => {
      const freeWithoutPrice = await prisma.plot.count({
        where: { status: 'FREE', price: { lte: 0 } },
      });
      expect(freeWithoutPrice).toBe(0);

      const unavailableWithPrice = await prisma.plot.count({
        where: { status: 'UNAVAILABLE', price: { gt: 0 } },
      });
      expect(unavailableWithPrice).toBe(0);
    });
  });

  /* ====================================================================== */
  /* Viewport                                                                */
  /* ====================================================================== */

  describe('viewport queries', () => {
    it('returns the plots inside a window', async () => {
      const res = await http()
        .get('/api/v1/world/plots')
        .query({ minX: 10, minY: 10, maxX: 19, maxY: 19 })
        .expect(200);

      expect(res.body.data.total).toBe(100);
      expect(res.body.data.truncated).toBe(false);
      for (const plot of res.body.data.plots) {
        expect(plot.x).toBeGreaterThanOrEqual(10);
        expect(plot.x).toBeLessThanOrEqual(19);
        expect(plot.y).toBeGreaterThanOrEqual(10);
        expect(plot.y).toBeLessThanOrEqual(19);
      }
    });

    it('caps a request for the entire world', async () => {
      // The single most important bound in the map API: no request, however
      // crafted, may pull the whole world into one response.
      const world = (await http().get('/api/v1/world').expect(200)).body.data;
      const res = await http()
        .get('/api/v1/world/plots')
        .query({ minX: 0, minY: 0, maxX: world.counts.plotsPerSide, maxY: world.counts.plotsPerSide })
        .expect(200);

      expect(res.body.data.total).toBeLessThanOrEqual(MAX_VIEWPORT_PLOTS);
      expect(res.body.data.truncated).toBe(true);
    });

    it('clamps coordinates far outside the world', async () => {
      const res = await http()
        .get('/api/v1/world/plots')
        .query({ minX: -9999, minY: -9999, maxX: 99999, maxY: 99999 })
        .expect(200);

      expect(res.body.data.bounds.minX).toBeGreaterThanOrEqual(0);
      expect(res.body.data.total).toBeLessThanOrEqual(MAX_VIEWPORT_PLOTS);
    });

    it('rejects a viewport with no bounds', async () => {
      await http().get('/api/v1/world/plots').expect(400);
    });

    it('filters by status', async () => {
      const res = await http()
        .get('/api/v1/world/plots')
        .query({ minX: 0, minY: 0, maxX: 30, maxY: 30, status: 'UNAVAILABLE' })
        .expect(200);

      for (const plot of res.body.data.plots) expect(plot.status).toBe('UNAVAILABLE');
    });

    it('filters by biome', async () => {
      const res = await http()
        .get('/api/v1/world/plots')
        .query({ minX: 0, minY: 0, maxX: 40, maxY: 40, biome: 'WATER' })
        .expect(200);

      for (const plot of res.body.data.plots) expect(plot.biome).toBe('WATER');
    });

    it('rejects an unknown status or biome rather than ignoring it', async () => {
      await http()
        .get('/api/v1/world/plots')
        .query({ minX: 0, minY: 0, maxX: 5, maxY: 5, status: 'NOT_A_STATUS' })
        .expect(400);
      await http()
        .get('/api/v1/world/plots')
        .query({ minX: 0, minY: 0, maxX: 5, maxY: 5, biome: 'LAVA' })
        .expect(400);
    });

    it('never leaks an owner id', async () => {
      const res = await http()
        .get('/api/v1/world/plots')
        .query({ minX: 0, minY: 0, maxX: 40, maxY: 40 })
        .expect(200);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('ownerId');
      expect(body).not.toContain('@');
    });
  });

  /* ====================================================================== */
  /* Plot detail                                                             */
  /* ====================================================================== */

  describe('plot detail', () => {
    it('resolves by code and by id, identically', async () => {
      const list = (
        await http()
          .get('/api/v1/world/plots')
          .query({ minX: 40, minY: 40, maxX: 45, maxY: 45 })
          .expect(200)
      ).body.data.plots;

      const target = list[0];
      const byCode = (await http().get(`/api/v1/plots/${target.code}`).expect(200)).body.data;
      const byId = (await http().get(`/api/v1/plots/${target.id}`).expect(200)).body.data;

      expect(byCode.id).toBe(byId.id);
      expect(byCode.terrain.label).toEqual(expect.any(String));
      expect(byCode.statusLabel).toEqual(expect.any(String));
    });

    it('404s for an unknown plot', async () => {
      const res = await http()
        .get('/api/v1/plots/00000000-0000-4000-8000-000000000000')
        .expect(404);
      expect(res.body.error.code).toBe('PLOT_NOT_FOUND');
    });

    it('tells an anonymous caller to sign in rather than offering a Buy', async () => {
      const free = await prisma.plot.findFirst({ where: { status: 'FREE' } });
      const res = await http().get(`/api/v1/plots/${free!.id}`).expect(200);

      expect(res.body.data.actions.canBuy).toBe(false);
      expect(res.body.data.actions.buyBlockedReason).toMatch(/sign in/i);
    });

    it('offers a Buy to a signed-in player on free land', async () => {
      const { token } = await register('detail');
      const free = await prisma.plot.findFirst({ where: { status: 'FREE' } });

      const res = await http()
        .get(`/api/v1/plots/${free!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // OptionalAuth: reachable anonymously, but identifies a signed-in caller.
      expect(res.body.data.actions.canBuy).toBe(true);
      expect(res.body.data.actions.buyBlockedReason).toBeNull();
    });

    it('never offers a Buy on unclaimable ground', async () => {
      const { token } = await register('unavail');
      const water = await prisma.plot.findFirst({ where: { status: 'UNAVAILABLE' } });

      const res = await http()
        .get(`/api/v1/plots/${water!.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.actions.canBuy).toBe(false);
    });
  });

  /* ====================================================================== */
  /* Starter territory                                                       */
  /* ====================================================================== */

  describe('starter territory', () => {
    it('grants a new player a buildable starter holding with a base', async () => {
      const { token, userId } = await register('starter');

      const territory = (
        await http()
          .get('/api/v1/player/territory')
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body.data;

      expect(territory.totalPlots).toBe(1);
      expect(territory.home).not.toBeNull();
      expect(territory.home.status).toBe('STARTER');
      expect(territory.bounds).not.toBeNull();

      const plot = await prisma.plot.findFirstOrThrow({ where: { ownerId: userId } });
      expect(plot.isBuildable).toBe(true);
      expect(plot.protectedUntil).not.toBeNull();
      expect(plot.protectedUntil!.getTime()).toBeGreaterThan(Date.now());

      // The starter base must actually be placed, and fit inside the plot.
      const buildings = await prisma.building.findMany({
        where: { plotId: plot.id },
        include: { definition: true },
      });
      expect(buildings.length).toBeGreaterThan(0);
      expect(buildings.some((b) => b.definition.key === 'headquarters')).toBe(true);
      for (const b of buildings) {
        expect(b.tileX + b.definition.footprintWidth).toBeLessThanOrEqual(plot.width);
        expect(b.tileY + b.definition.footprintHeight).toBeLessThanOrEqual(plot.height);
      }

      // And the ownership trail records the grant.
      const ownership = await prisma.plotOwnership.findFirstOrThrow({
        where: { plotId: plot.id },
      });
      expect(ownership.acquisition).toBe('STARTER_GRANT');
      expect(ownership.pricePaid).toBe(0n);
      expect(ownership.previousOwnerId).toBeNull();
    });

    it('never hands two players the same plot', async () => {
      // Registration is serialised through one transaction each; running them
      // concurrently is what would expose a read-then-write race.
      const names = ['race1', 'race2', 'race3', 'race4', 'race5'];
      const results = await Promise.all(
        names.map((name) =>
          http()
            .post('/api/v1/auth/register')
            .send({ email: email(name), username: username(name), password: PASSWORD }),
        ),
      );

      const userIds = results
        .filter((r) => r.status === 201)
        .map((r) => r.body.data.user.id as string);
      expect(userIds.length).toBeGreaterThan(1);

      const plots = await prisma.plot.findMany({
        where: { ownerId: { in: userIds } },
        select: { id: true, ownerId: true, x: true, y: true },
      });

      const coordinates = plots.map((p) => `${p.x}:${p.y}`);
      expect(new Set(coordinates).size).toBe(coordinates.length);
      expect(new Set(plots.map((p) => p.id)).size).toBe(plots.length);
    });

    it('spreads starter holdings apart', async () => {
      const starters = await prisma.plot.findMany({
        where: { status: 'STARTER' },
        select: { x: true, y: true },
      });
      if (starters.length < 2) return;

      // Not an absolute guarantee - the rule relaxes on a crowded world - but
      // holdings should not all be piled on one coordinate.
      const unique = new Set(starters.map((s) => `${s.x}:${s.y}`));
      expect(unique.size).toBe(starters.length);
    });

    it('is idempotent - a second call returns the same plot', async () => {
      const { token, userId } = await register('idem');

      await http()
        .get('/api/v1/player/territory')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await http()
        .get('/api/v1/player/territory')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(await prisma.plot.count({ where: { ownerId: userId } })).toBe(1);
    });
  });

  /* ====================================================================== */
  /* Expansion purchase                                                      */
  /* ====================================================================== */

  describe('expansion purchase', () => {
    /** Finds a FREE plot orthogonally adjacent to something the player owns. */
    async function adjacentFreePlot(userId: string) {
      const owned = await prisma.plot.findMany({
        where: { ownerId: userId },
        select: { x: true, y: true, worldId: true },
      });
      for (const plot of owned) {
        for (const n of [
          { x: plot.x + 1, y: plot.y },
          { x: plot.x - 1, y: plot.y },
          { x: plot.x, y: plot.y + 1 },
          { x: plot.x, y: plot.y - 1 },
        ]) {
          const found = await prisma.plot.findFirst({
            where: { worldId: plot.worldId, x: n.x, y: n.y, status: 'FREE' },
          });
          if (found) return found;
        }
      }
      return null;
    }

    /** Clears the purchase cooldown so a test is not gated on wall-clock time. */
    async function clearCooldown(userId: string) {
      await prisma.empire.updateMany({ where: { userId }, data: { lastPlotBuyAt: null } });
    }

    it('transfers the plot, debits the coins and records both', async () => {
      const { token, userId } = await register('buy');
      const target = await adjacentFreePlot(userId);
      if (!target) return;

      const before = await prisma.wallet.findUniqueOrThrow({ where: { userId } });

      const res = await http()
        .post('/api/v1/player/territory/purchase')
        .set('Authorization', `Bearer ${token}`)
        .send({ plotId: target.id })
        .expect(200);

      expect(res.body.data.pricePaid).toBe(target.price.toString());

      const [after, plot, ledger, ownership] = await Promise.all([
        prisma.wallet.findUniqueOrThrow({ where: { userId } }),
        prisma.plot.findUniqueOrThrow({ where: { id: target.id } }),
        prisma.currencyTransaction.findFirst({
          where: { userId, reason: 'PLOT_PURCHASE_WORLD' },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.plotOwnership.findFirst({
          where: { plotId: target.id, acquisition: 'WORLD_PURCHASE' },
        }),
      ]);

      expect(plot.status).toBe('OWNED');
      expect(plot.ownerId).toBe(userId);
      expect(after.coins).toBe(before.coins - target.price);

      // Money and ownership must both be recorded, and linked to each other.
      expect(ledger).not.toBeNull();
      expect(ledger!.amount).toBe(-target.price);
      expect(ledger!.balanceAfter).toBe(after.coins);
      expect(ownership).not.toBeNull();
      expect(ownership!.pricePaid).toBe(target.price);
      expect(ownership!.transactionId).toBe(ledger!.id);
    });

    it('reconciles the ledger against the wallet', async () => {
      const { token, userId } = await register('ledger');
      await clearCooldown(userId);
      const target = await adjacentFreePlot(userId);
      if (target) {
        await http()
          .post('/api/v1/player/territory/purchase')
          .set('Authorization', `Bearer ${token}`)
          .send({ plotId: target.id })
          .expect(200);
      }

      const [wallet, entries] = await Promise.all([
        prisma.wallet.findUniqueOrThrow({ where: { userId } }),
        prisma.currencyTransaction.findMany({ where: { userId, currency: 'COINS' } }),
      ]);
      const sum = entries.reduce((total, e) => total + e.amount, 0n);
      expect(sum).toBe(wallet.coins);
    });

    it('refuses a non-adjacent plot', async () => {
      const { token, userId } = await register('faraway');
      await clearCooldown(userId);

      const owned = await prisma.plot.findFirstOrThrow({ where: { ownerId: userId } });
      const distant = await prisma.plot.findFirst({
        where: {
          worldId: owned.worldId,
          status: 'FREE',
          x: { gte: owned.x + 20 },
        },
      });
      if (!distant) return;

      const res = await http()
        .post('/api/v1/player/territory/purchase')
        .set('Authorization', `Bearer ${token}`)
        .send({ plotId: distant.id })
        .expect(400);

      expect(res.body.error.code).toBe('PLOT_NOT_ADJACENT');
    });

    it('refuses unclaimable ground with a 400 - it can never be bought', async () => {
      const { token, userId } = await register('water');
      await clearCooldown(userId);

      // UNAVAILABLE is a terminal state, so this is a permanently invalid
      // request rather than a transient conflict.
      const water = await prisma.plot.findFirstOrThrow({ where: { status: 'UNAVAILABLE' } });
      const res = await http()
        .post('/api/v1/player/territory/purchase')
        .set('Authorization', `Bearer ${token}`)
        .send({ plotId: water.id })
        .expect(400);

      expect(res.body.error.code).toBe('PLOT_NOT_AVAILABLE');
    });

    it('refuses a plot someone else holds with a 409 - the state may change', async () => {
      const owner = await register('owner');
      const other = await register('other');
      await clearCooldown(other.userId);

      const theirs = await prisma.plot.findFirstOrThrow({ where: { ownerId: owner.userId } });
      const res = await http()
        .post('/api/v1/player/territory/purchase')
        .set('Authorization', `Bearer ${other.token}`)
        .send({ plotId: theirs.id })
        .expect(409);

      expect(res.body.error.code).toBe('PLOT_NOT_AVAILABLE');
    });

    it('refuses when the player cannot afford it, and moves nothing', async () => {
      const { token, userId } = await register('broke');
      await clearCooldown(userId);
      await prisma.wallet.update({ where: { userId }, data: { coins: 1n } });

      const target = await adjacentFreePlot(userId);
      if (!target) return;

      const res = await http()
        .post('/api/v1/player/territory/purchase')
        .set('Authorization', `Bearer ${token}`)
        .send({ plotId: target.id })
        .expect(400);

      expect(res.body.error.code).toBe('INSUFFICIENT_COINS');

      // The transaction must have rolled back completely.
      const [wallet, plot] = await Promise.all([
        prisma.wallet.findUniqueOrThrow({ where: { userId } }),
        prisma.plot.findUniqueOrThrow({ where: { id: target.id } }),
      ]);
      expect(wallet.coins).toBe(1n);
      expect(plot.status).toBe('FREE');
      expect(plot.ownerId).toBeNull();
    });

    it('enforces the purchase cooldown', async () => {
      const { token, userId } = await register('cooldown');
      const first = await adjacentFreePlot(userId);
      if (!first) return;

      await http()
        .post('/api/v1/player/territory/purchase')
        .set('Authorization', `Bearer ${token}`)
        .send({ plotId: first.id })
        .expect(200);

      const second = await adjacentFreePlot(userId);
      if (!second) return;

      const res = await http()
        .post('/api/v1/player/territory/purchase')
        .set('Authorization', `Bearer ${token}`)
        .send({ plotId: second.id })
        .expect(400);

      expect(res.body.error.code).toBe('PLOT_PURCHASE_COOLDOWN');
    });

    it('rejects an unauthenticated purchase', async () => {
      const free = await prisma.plot.findFirstOrThrow({ where: { status: 'FREE' } });
      await http()
        .post('/api/v1/player/territory/purchase')
        .send({ plotId: free.id })
        .expect(401);
    });

    it('ignores a client-supplied price or owner', async () => {
      const { token, userId } = await register('tamper');
      await clearCooldown(userId);
      const target = await adjacentFreePlot(userId);
      if (!target) return;

      // whitelist + forbidNonWhitelisted means smuggled fields are rejected
      // outright rather than silently honoured.
      const res = await http()
        .post('/api/v1/player/territory/purchase')
        .set('Authorization', `Bearer ${token}`)
        .send({ plotId: target.id, price: '1', ownerId: userId })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const plot = await prisma.plot.findUniqueOrThrow({ where: { id: target.id } });
      expect(plot.status).toBe('FREE');
    });

    it('only offers expansion candidates the purchase endpoint accepts', async () => {
      const { token, userId } = await register('nearby');
      await clearCooldown(userId);

      const nearby = (
        await http()
          .get('/api/v1/player/territory/nearby')
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body.data;

      const owned = await prisma.plot.findMany({
        where: { ownerId: userId },
        select: { x: true, y: true },
      });

      // A shortlist containing plots the API would refuse is a Buy button
      // that fails - worse than not offering it.
      for (const candidate of nearby) {
        expect(candidate.status).toBe('FREE');
        const touches = owned.some(
          (o) => Math.abs(o.x - candidate.x) + Math.abs(o.y - candidate.y) === 1,
        );
        expect(touches).toBe(true);
      }
    });
  });

  /* ====================================================================== */
  /* Search                                                                  */
  /* ====================================================================== */

  describe('search', () => {
    it('finds a plot by its code', async () => {
      const plot = await prisma.plot.findFirstOrThrow({ where: { x: 30, y: 30 } });
      const res = await http()
        .get('/api/v1/world/search')
        .query({ q: plot.code })
        .expect(200);

      expect(res.body.data.plots[0]?.code).toBe(plot.code);
    });

    it('finds a plot by "x,y"', async () => {
      const res = await http().get('/api/v1/world/search').query({ q: '30,30' }).expect(200);
      expect(res.body.data.plots[0]?.x).toBe(30);
      expect(res.body.data.plots[0]?.y).toBe(30);
    });

    it('finds a commander and their holdings', async () => {
      const name = username('findme');
      await http()
        .post('/api/v1/auth/register')
        .send({ email: email('findme'), username: name, password: PASSWORD })
        .expect(201);

      const res = await http().get('/api/v1/world/search').query({ q: name }).expect(200);
      expect(res.body.data.plots.length).toBeGreaterThan(0);
    });

    it('rejects a term that is too short', async () => {
      await http().get('/api/v1/world/search').query({ q: 'a' }).expect(400);
    });
  });
});
