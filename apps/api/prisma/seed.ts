/**
 * =============================================================================
 * EMPIRE FRONTIER - database seed
 * =============================================================================
 * Idempotent: safe to run on every container start. Everything is an upsert
 * keyed on a natural key, so re-running updates the catalogue rather than
 * duplicating it.
 *
 *   docker compose exec backend npx prisma db seed
 *
 * Seeds in this phase:
 *   * game configuration defaults
 *   * resources
 *   * building definitions + every level
 *   * unit definitions
 *   * quests and achievements
 *   * payment packages
 *   * a bootstrap admin account
 *
 *   * the persistent world (regions, zones, plots)
 *
 * World generation is idempotent on the world slug: if the world already
 * exists it is left alone, so a redeploy never rebuilds terrain under a
 * player's feet.
 * =============================================================================
 */
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import {
  Biome,
  BuildingCategory,
  CurrencyKey,
  PrismaClient,
  QuestKind,
  ResourceKind,
  UnitClass,
  UserRole,
  UserStatus,
  Prisma,
} from '@prisma/client';
import {
  BUILDINGS,
  DEFAULT_WORLD_GEOMETRY,
  GAME_CONFIG_DEFAULTS,
  RESOURCES,
  TERRAIN_RULES,
  UNITS,
  isClaimable,
  locatePlot,
  plotCode,
  regionCode,
  validateGeometry,
  worldCounts,
  zoneCode,
  WorldGeometry,
} from '@empire/game-data';
import {
  calculatePlotPrice,
  dominantBiome,
  plotTerrain,
  regionName,
  unbuildableCoverageBps,
  WorldGenParams,
} from '@empire/game-engine';

const prisma = new PrismaClient();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const log = (message: string) => console.log(`  ${message}`);
const section = (title: string) => console.log(`\n[36m▸ ${title}[0m`);

function valueTypeOf(value: unknown): string {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/* -------------------------------------------------------------------------- */
/* 1. Game configuration                                                       */
/* -------------------------------------------------------------------------- */

async function seedGameConfig(): Promise<void> {
  section('Game configuration');
  for (const entry of GAME_CONFIG_DEFAULTS) {
    await prisma.gameConfig.upsert({
      where: { key: entry.key },
      // Only description/group/type are refreshed. The *value* is left alone
      // so a balance change made in the admin panel is not silently reverted
      // by the next deploy.
      update: {
        description: entry.description,
        group: entry.group,
        valueType: valueTypeOf(entry.value),
      },
      create: {
        key: entry.key,
        value: String(entry.value),
        valueType: valueTypeOf(entry.value),
        description: entry.description,
        group: entry.group,
      },
    });
  }
  log(`${GAME_CONFIG_DEFAULTS.length} config keys`);
}

/* -------------------------------------------------------------------------- */
/* 2. Resources                                                                */
/* -------------------------------------------------------------------------- */

async function seedResources(): Promise<void> {
  section('Resources');
  for (const resource of RESOURCES) {
    const data = {
      name: resource.name,
      description: resource.description,
      kind: resource.kind.toUpperCase() as ResourceKind,
      raidable: resource.raidable,
      maxLootBps: resource.maxLootBps,
      baseStorage: resource.baseStorage,
      color: resource.color,
      icon: resource.icon,
    };
    await prisma.resource.upsert({
      where: { key: resource.key as CurrencyKey },
      update: data,
      create: { key: resource.key as CurrencyKey, ...data },
    });
  }
  log(`${RESOURCES.length} resources`);
}

/* -------------------------------------------------------------------------- */
/* 3. Buildings and their level tables                                         */
/* -------------------------------------------------------------------------- */

async function seedBuildings(): Promise<void> {
  section('Buildings');
  let levelCount = 0;

  for (const building of BUILDINGS) {
    const definition = await prisma.buildingDefinition.upsert({
      where: { key: building.key },
      update: {
        name: building.name,
        description: building.description,
        category: building.category as BuildingCategory,
        footprintWidth: building.footprint.width,
        footprintHeight: building.footprint.height,
        isUnique: building.unique,
        blocksMovement: building.blocksMovement,
        allowedBiomes: building.allowedBiomes as Biome[],
        asset: building.asset as unknown as Prisma.InputJsonValue,
      },
      create: {
        key: building.key,
        name: building.name,
        description: building.description,
        category: building.category as BuildingCategory,
        footprintWidth: building.footprint.width,
        footprintHeight: building.footprint.height,
        isUnique: building.unique,
        blocksMovement: building.blocksMovement,
        allowedBiomes: building.allowedBiomes as Biome[],
        asset: building.asset as unknown as Prisma.InputJsonValue,
      },
    });

    for (const level of building.levels) {
      const payload = {
        buildCost: level.buildCost as Prisma.InputJsonValue,
        buildSeconds: level.buildSeconds,
        hitpoints: level.hitpoints,
        production: (level.production ?? undefined) as Prisma.InputJsonValue,
        storage: (level.storage ?? undefined) as Prisma.InputJsonValue,
        defense: (level.defense ?? undefined) as Prisma.InputJsonValue,
        capacity: (level.capacity ?? undefined) as Prisma.InputJsonValue,
        requiredHqLevel: level.requiredHqLevel,
        maxCountAtHq: level.maxCountAtHq ?? null,
      };

      await prisma.buildingLevel.upsert({
        where: { definitionId_level: { definitionId: definition.id, level: level.level } },
        update: payload,
        create: { definitionId: definition.id, level: level.level, ...payload },
      });
      levelCount++;
    }
  }

  log(`${BUILDINGS.length} building definitions, ${levelCount} levels`);
}

/* -------------------------------------------------------------------------- */
/* 4. Units                                                                    */
/* -------------------------------------------------------------------------- */

async function seedUnits(): Promise<void> {
  section('Units');
  for (const unit of UNITS) {
    const data = {
      name: unit.name,
      description: unit.description,
      unitClass: unit.unitClass as UnitClass,
      hitpoints: unit.hitpoints,
      damage: unit.damage,
      defense: unit.defense,
      speed: unit.speed,
      range: unit.range,
      attackCooldownMs: unit.attackCooldownMs,
      trainCost: unit.trainCost as Prisma.InputJsonValue,
      trainSeconds: unit.trainSeconds,
      population: unit.population,
      trainedAt: unit.trainedAt,
      unlockAtBuildingLevel: unit.unlockAtBuildingLevel,
      preferredTargets: (unit.preferredTargets ?? undefined) as Prisma.InputJsonValue,
      asset: unit.asset as unknown as Prisma.InputJsonValue,
    };
    await prisma.unitDefinition.upsert({
      where: { key: unit.key },
      update: data,
      create: { key: unit.key, ...data },
    });
  }
  log(`${UNITS.length} unit definitions`);
}

/* -------------------------------------------------------------------------- */
/* 5. Quests                                                                   */
/* -------------------------------------------------------------------------- */

const QUESTS = [
  {
    key: 'daily.build_three',
    kind: QuestKind.DAILY,
    title: 'Raise Three Structures',
    description: 'Complete construction on three buildings anywhere in your empire.',
    objective: { type: 'BUILDINGS_COMPLETED', target: 3 },
    rewards: { COINS: 600, xp: 120 },
    requiredLevel: 1,
    sortOrder: 10,
  },
  {
    key: 'daily.collect_wood',
    kind: QuestKind.DAILY,
    title: 'Fill the Timber Yards',
    description: 'Collect 5,000 timber from your lumber mills.',
    objective: { type: 'RESOURCE_COLLECTED', resource: 'WOOD', target: 5000 },
    rewards: { COINS: 450, xp: 90 },
    requiredLevel: 1,
    sortOrder: 20,
  },
  {
    key: 'daily.win_two_raids',
    kind: QuestKind.DAILY,
    title: 'Two Victories',
    description: 'Win two raids against rival empires.',
    objective: { type: 'BATTLES_WON', target: 2 },
    rewards: { COINS: 1200, GEMS: 3, xp: 300 },
    requiredLevel: 4,
    sortOrder: 30,
  },
  {
    key: 'daily.hold_the_line',
    kind: QuestKind.DAILY,
    title: 'Hold the Line',
    description: 'Successfully defend your empire against one attack.',
    objective: { type: 'RAIDS_DEFENDED', target: 1 },
    rewards: { COINS: 900, xp: 200 },
    requiredLevel: 4,
    sortOrder: 40,
  },
  {
    key: 'weekly.upgrade_hq',
    kind: QuestKind.WEEKLY,
    title: 'Expand the Seat of Power',
    description: 'Upgrade your Headquarters by one level.',
    objective: { type: 'BUILDING_UPGRADED', buildingKey: 'headquarters', target: 1 },
    rewards: { COINS: 4000, GEMS: 10, xp: 900 },
    requiredLevel: 2,
    sortOrder: 100,
  },
  {
    key: 'weekly.acquire_land',
    kind: QuestKind.WEEKLY,
    title: 'Claim New Ground',
    description: 'Acquire one additional plot of territory.',
    objective: { type: 'PLOTS_ACQUIRED', target: 1 },
    rewards: { COINS: 3000, xp: 700 },
    requiredLevel: 3,
    sortOrder: 110,
  },
  {
    key: 'weekly.train_army',
    kind: QuestKind.WEEKLY,
    title: 'Muster the Ranks',
    description: 'Train 50 units of any type.',
    objective: { type: 'UNITS_TRAINED', target: 50 },
    rewards: { COINS: 2500, GEMS: 5, xp: 600 },
    requiredLevel: 2,
    sortOrder: 120,
  },
  {
    key: 'story.first_steps',
    kind: QuestKind.STORY,
    title: 'First Steps',
    description: 'Place your first new building on your starting territory.',
    objective: { type: 'BUILDINGS_COMPLETED', target: 1 },
    rewards: { COINS: 250, xp: 50 },
    requiredLevel: 1,
    sortOrder: 1,
  },
];

async function seedQuests(): Promise<void> {
  section('Quests');
  for (const quest of QUESTS) {
    const data = {
      kind: quest.kind,
      title: quest.title,
      description: quest.description,
      objective: quest.objective as Prisma.InputJsonValue,
      rewards: quest.rewards as Prisma.InputJsonValue,
      requiredLevel: quest.requiredLevel,
      sortOrder: quest.sortOrder,
      isActive: true,
    };
    await prisma.quest.upsert({
      where: { key: quest.key },
      update: data,
      create: { key: quest.key, ...data },
    });
  }
  log(`${QUESTS.length} quests`);
}

/* -------------------------------------------------------------------------- */
/* 6. Achievements                                                             */
/* -------------------------------------------------------------------------- */

const ACHIEVEMENTS = [
  {
    key: 'builder',
    title: 'Master Builder',
    description: 'Complete construction on buildings across your empire.',
    category: 'construction',
    criteria: { type: 'BUILDINGS_COMPLETED', tiers: [5, 25, 100, 400] },
    rewards: { tiers: [{ COINS: 500 }, { COINS: 2000 }, { COINS: 8000, GEMS: 10 }, { COINS: 30000, GEMS: 50 }] },
    icon: 'hammer',
    sortOrder: 10,
  },
  {
    key: 'conqueror',
    title: 'Conqueror',
    description: 'Win raids against rival empires.',
    category: 'combat',
    criteria: { type: 'BATTLES_WON', tiers: [1, 10, 50, 250] },
    rewards: { tiers: [{ COINS: 400 }, { COINS: 2500 }, { COINS: 12000, GEMS: 15 }, { COINS: 60000, GEMS: 80 }] },
    icon: 'sword',
    sortOrder: 20,
  },
  {
    key: 'bulwark',
    title: 'Bulwark',
    description: 'Repel attacks on your own territory.',
    category: 'combat',
    criteria: { type: 'RAIDS_DEFENDED', tiers: [1, 10, 50, 250] },
    rewards: { tiers: [{ COINS: 400 }, { COINS: 2500 }, { COINS: 12000, GEMS: 15 }, { COINS: 60000, GEMS: 80 }] },
    icon: 'shield',
    sortOrder: 30,
  },
  {
    key: 'landholder',
    title: 'Landholder',
    description: 'Hold territory across the frontier.',
    category: 'territory',
    criteria: { type: 'PLOTS_OWNED', tiers: [2, 4, 8, 12] },
    rewards: { tiers: [{ COINS: 1000 }, { COINS: 4000 }, { COINS: 15000, GEMS: 20 }, { COINS: 50000, GEMS: 60 }] },
    icon: 'map',
    sortOrder: 40,
  },
  {
    key: 'merchant',
    title: 'Frontier Merchant',
    description: 'Complete marketplace sales as a seller.',
    category: 'economy',
    criteria: { type: 'MARKET_SALES', tiers: [1, 10, 50] },
    rewards: { tiers: [{ COINS: 750 }, { COINS: 5000 }, { COINS: 25000, GEMS: 25 }] },
    icon: 'scales',
    sortOrder: 50,
  },
  {
    key: 'quartermaster',
    title: 'Quartermaster',
    description: 'Train units to fill your ranks.',
    category: 'military',
    criteria: { type: 'UNITS_TRAINED', tiers: [50, 500, 5000] },
    rewards: { tiers: [{ COINS: 600 }, { COINS: 4000 }, { COINS: 20000, GEMS: 20 }] },
    icon: 'banner',
    sortOrder: 60,
  },
];

async function seedAchievements(): Promise<void> {
  section('Achievements');
  for (const achievement of ACHIEVEMENTS) {
    const data = {
      title: achievement.title,
      description: achievement.description,
      category: achievement.category,
      criteria: achievement.criteria as Prisma.InputJsonValue,
      rewards: achievement.rewards as Prisma.InputJsonValue,
      icon: achievement.icon,
      sortOrder: achievement.sortOrder,
    };
    await prisma.achievement.upsert({
      where: { key: achievement.key },
      update: data,
      create: { key: achievement.key, ...data },
    });
  }
  log(`${ACHIEVEMENTS.length} achievements`);
}

/* -------------------------------------------------------------------------- */
/* 7. Premium packages                                                         */
/* -------------------------------------------------------------------------- */

// Amounts are in minor units (paise). Prices are placeholders for development
// and must be reviewed against local tax/pricing rules before going live.
const PACKAGES = [
  { sku: 'gems_small', name: 'Pouch of Gems', description: 'A small reserve for rushing a timer.', amountMinor: 9900n, gems: 100, bonusGems: 0, sortOrder: 10 },
  { sku: 'gems_medium', name: 'Chest of Gems', description: 'Enough to keep two builders busy.', amountMinor: 49900n, gems: 550, bonusGems: 50, sortOrder: 20 },
  { sku: 'gems_large', name: 'Vault of Gems', description: 'Serious expansion fuel.', amountMinor: 99900n, gems: 1200, bonusGems: 200, sortOrder: 30 },
  { sku: 'gems_huge', name: "Sovereign's Hoard", description: 'The largest reserve on offer.', amountMinor: 199900n, gems: 2600, bonusGems: 600, sortOrder: 40 },
];

async function seedPackages(currency: string): Promise<void> {
  section('Premium packages');
  for (const pkg of PACKAGES) {
    const data = {
      name: pkg.name,
      description: pkg.description,
      amountMinor: pkg.amountMinor,
      currency,
      gems: pkg.gems,
      bonusGems: pkg.bonusGems,
      sortOrder: pkg.sortOrder,
      isActive: true,
    };
    await prisma.paymentPackage.upsert({
      where: { sku: pkg.sku },
      update: data,
      create: { sku: pkg.sku, ...data },
    });
  }
  log(`${PACKAGES.length} packages in ${currency}`);
}

/* -------------------------------------------------------------------------- */
/* 8. The persistent world                                                     */
/* -------------------------------------------------------------------------- */

const INSERT_CHUNK = 1000;

async function chunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await insert(rows.slice(i, i + INSERT_CHUNK));
  }
}

/**
 * Generates the world if it does not already exist.
 *
 * Deterministic: the same seed always produces identical terrain, so only the
 * seed is persisted and per-tile detail is recomputed on demand. Idempotent on
 * the slug, so re-running the seed on every container start is safe.
 */
async function seedWorld(): Promise<void> {
  section('World');

  const slug = process.env.WORLD_SLUG ?? 'frontier';
  const seed = process.env.WORLD_SEED ?? 'EMPIRE-001';

  const existing = await prisma.world.findUnique({
    where: { slug },
    select: { id: true, seed: true, status: true },
  });

  if (existing) {
    const plots = await prisma.plot.count({ where: { worldId: existing.id } });
    log(`world "${slug}" already exists (seed ${existing.seed}, ${plots} plots) - leaving it alone`);
    return;
  }

  const geometry: WorldGeometry = {
    width: Number(process.env.WORLD_WIDTH ?? DEFAULT_WORLD_GEOMETRY.width),
    height: Number(process.env.WORLD_WIDTH ?? DEFAULT_WORLD_GEOMETRY.height),
    regionSize: Number(process.env.WORLD_REGION_SIZE ?? DEFAULT_WORLD_GEOMETRY.regionSize),
    zoneSize: Number(process.env.WORLD_ZONE_SIZE ?? DEFAULT_WORLD_GEOMETRY.zoneSize),
    plotSize: Number(process.env.WORLD_PLOT_SIZE ?? DEFAULT_WORLD_GEOMETRY.plotSize),
  };
  validateGeometry(geometry);

  const counts = worldCounts(geometry);
  const params: WorldGenParams = { seed, size: geometry.width };
  const started = Date.now();

  log(
    `generating "${slug}" seed=${seed} ${geometry.width}x${geometry.height} tiles -> ` +
      `${counts.totalRegions} regions, ${counts.totalZones} zones, ${counts.totalPlots} plots`,
  );

  // Created as GENERATING so a crash leaves an obviously-incomplete world
  // rather than a plausible-looking one that players could join.
  const world = await prisma.world.create({
    data: {
      slug,
      name: process.env.WORLD_NAME ?? 'The Frontier',
      seed,
      width: geometry.width,
      height: geometry.height,
      regionSize: geometry.regionSize,
      zoneSize: geometry.zoneSize,
      plotSize: geometry.plotSize,
      status: 'GENERATING',
    },
  });

  /* ---- regions ---------------------------------------------------------- */
  const regionRows: Prisma.RegionCreateManyInput[] = [];
  for (let y = 0; y < counts.regionsPerSide; y++) {
    for (let x = 0; x < counts.regionsPerSide; x++) {
      const tileX = x * geometry.regionSize;
      const tileY = y * geometry.regionSize;
      const biome = dominantBiome(params, tileX, tileY, geometry.regionSize);
      regionRows.push({
        worldId: world.id,
        x,
        y,
        width: geometry.regionSize,
        height: geometry.regionSize,
        tileX,
        tileY,
        name: regionName(seed, x, y),
        seed: `${seed}:${regionCode(x, y)}`,
        biome: biome as Biome,
        priceModifierBps: TERRAIN_RULES[biome].priceModifierBps,
      });
    }
  }
  await chunked(regionRows, (chunk) =>
    prisma.region.createMany({ data: chunk, skipDuplicates: true }),
  );
  const regionIds = new Map(
    (await prisma.region.findMany({ where: { worldId: world.id }, select: { id: true, x: true, y: true } })).map(
      (r) => [`${r.x}:${r.y}`, r.id],
    ),
  );
  log(`${regionRows.length} regions`);

  /* ---- zones ------------------------------------------------------------ */
  const zonesPerRegionSide = geometry.regionSize / geometry.zoneSize;
  const zoneRows: Prisma.ZoneCreateManyInput[] = [];
  for (let y = 0; y < counts.zonesPerSide; y++) {
    for (let x = 0; x < counts.zonesPerSide; x++) {
      const regionId = regionIds.get(
        `${Math.floor(x / zonesPerRegionSide)}:${Math.floor(y / zonesPerRegionSide)}`,
      );
      if (!regionId) throw new Error(`zone ${x},${y} has no parent region`);
      const tileX = x * geometry.zoneSize;
      const tileY = y * geometry.zoneSize;
      zoneRows.push({
        worldId: world.id,
        regionId,
        x,
        y,
        width: geometry.zoneSize,
        height: geometry.zoneSize,
        tileX,
        tileY,
        seed: `${seed}:${zoneCode(x, y)}`,
        biome: dominantBiome(params, tileX, tileY, geometry.zoneSize, 4) as Biome,
        isOpen: true,
      });
    }
  }
  await chunked(zoneRows, (chunk) => prisma.zone.createMany({ data: chunk, skipDuplicates: true }));
  const zoneIds = new Map(
    (await prisma.zone.findMany({ where: { worldId: world.id }, select: { id: true, x: true, y: true } })).map(
      (z) => [`${z.x}:${z.y}`, z.id],
    ),
  );
  log(`${zoneRows.length} zones`);

  /* ---- plots ------------------------------------------------------------ */
  const basePriceRow = await prisma.gameConfig.findUnique({ where: { key: 'land.basePlotPrice' } });
  const basePrice = Number(basePriceRow?.value ?? 2500);

  const breakdown: Record<string, number> = {};
  const plotRows: Prisma.PlotCreateManyInput[] = [];
  const centre = counts.plotsPerSide / 2;

  for (let y = 0; y < counts.plotsPerSide; y++) {
    for (let x = 0; x < counts.plotsPerSide; x++) {
      const loc = locatePlot(geometry, x, y);
      const zoneId = zoneIds.get(`${loc.zoneX}:${loc.zoneY}`);
      const regionId = regionIds.get(`${loc.regionX}:${loc.regionY}`);
      if (!zoneId || !regionId) throw new Error(`plot ${x},${y} has no parent zone/region`);

      const biome = dominantBiome(params, loc.tileX, loc.tileY, geometry.plotSize, 3) as Biome;
      const rule = TERRAIN_RULES[biome];
      const unbuildableBps = unbuildableCoverageBps(params, x, y, geometry.plotSize);
      breakdown[biome] = (breakdown[biome] ?? 0) + 1;

      // Water and sheer rock are scenery, not inventory - UNAVAILABLE is a
      // terminal state, so they can never be claimed or sold.
      const claimable = isClaimable(biome);

      plotRows.push({
        worldId: world.id,
        regionId,
        zoneId,
        code: plotCode(geometry, x, y),
        x,
        y,
        width: geometry.plotSize,
        height: geometry.plotSize,
        tileX: loc.tileX,
        tileY: loc.tileY,
        biome,
        status: claimable ? 'FREE' : 'UNAVAILABLE',
        isBuildable: rule.buildability !== 'BLOCKED',
        price: claimable
          ? calculatePlotPrice({
              basePrice,
              biomeModifierBps: rule.priceModifierBps,
              regionModifierBps: 10000,
              unbuildableBps,
              distanceFromCentre: Math.max(Math.abs(x - centre), Math.abs(y - centre)),
              plotsPerSide: counts.plotsPerSide,
            })
          : 0n,
        isForSale: false,
        waterCoverageBps: unbuildableBps,
        terrain: plotTerrain(params, x, y, geometry.plotSize) as unknown as Prisma.InputJsonValue,
      });
    }
  }
  await chunked(plotRows, (chunk) => prisma.plot.createMany({ data: chunk, skipDuplicates: true }));

  await prisma.world.update({
    where: { id: world.id },
    data: { status: 'ACTIVE', generatedAt: new Date() },
  });

  const claimable = plotRows.filter((p) => p.status === 'FREE').length;
  log(`${plotRows.length} plots (${claimable} claimable) in ${Date.now() - started}ms`);

  const summary = Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([biome, n]) => `${biome.toLowerCase()} ${n}`)
    .join(', ');
  log(`biomes: ${summary}`);
}

/* -------------------------------------------------------------------------- */
/* 8. Bootstrap admin                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Creates the first SUPER_ADMIN so the admin panel is reachable on a fresh
 * database.
 *
 * No password is ever hardcoded. SEED_ADMIN_PASSWORD is used when supplied;
 * otherwise a strong random one is generated and printed exactly once. An
 * existing admin is never overwritten - re-running the seed will not reset a
 * password that has already been changed.
 */
async function seedAdmin(): Promise<void> {
  section('Bootstrap admin');

  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@empire-frontier.local').toLowerCase();
  const username = process.env.SEED_ADMIN_USERNAME ?? 'overseer';

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { id: true, email: true, role: true },
  });

  if (existing) {
    if (existing.role !== UserRole.SUPER_ADMIN) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: UserRole.SUPER_ADMIN },
      });
      log(`promoted existing account ${existing.email} to SUPER_ADMIN`);
    } else {
      log(`admin ${existing.email} already exists - password left untouched`);
    }
    return;
  }

  // `|| undefined` rather than a bare `?.trim()`: SEED_ADMIN_PASSWORD is
  // present-but-empty in the shipped .env, and `??` does not fall back on an
  // empty string - which would hash "" into a working admin credential.
  const supplied = process.env.SEED_ADMIN_PASSWORD?.trim() || undefined;
  const generated = supplied ? undefined : `${randomBytes(12).toString('base64url')}Aa1!`;
  const password = supplied ?? generated;

  // Belt and braces: never create a privileged account with a weak or empty
  // password, whatever the environment says.
  if (!password || password.length < 12) {
    throw new Error(
      'Refusing to create the bootstrap admin: the resolved password is empty or too short. ' +
        'Leave SEED_ADMIN_PASSWORD blank to auto-generate one, or set a strong value.',
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'Overseer', empireName: 'Frontier Command' } },
      wallet: { create: {} },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorType: 'SYSTEM',
      action: 'seed.admin_created',
      entityType: 'User',
      entityId: user.id,
      after: { email, username, role: UserRole.SUPER_ADMIN },
    },
  });

  if (generated) {
    console.log(
      '\n[33m' +
        '+=====================================================================+\n' +
        '|  BOOTSTRAP ADMIN CREATED - this password is shown ONCE              |\n' +
        `|  email:    ${email.padEnd(56)}|\n` +
        `|  password: ${generated.padEnd(56)}|\n` +
        '|  Sign in at http://localhost/admin and change it immediately.       |\n' +
        '+=====================================================================+' +
        '[0m\n',
    );
  } else {
    log(`admin ${email} created with the password from SEED_ADMIN_PASSWORD`);
  }
}

/* -------------------------------------------------------------------------- */
/* Entrypoint                                                                  */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log('\n[1mSeeding Empire Frontier[0m');

  await seedGameConfig();
  await seedResources();
  await seedBuildings();
  await seedUnits();
  await seedQuests();
  await seedAchievements();
  await seedPackages(process.env.PAYMENT_CURRENCY ?? 'INR');
  await seedWorld();
  await seedAdmin();

  console.log('\n[32m✓ Seed complete.[0m');
}

main()
  .catch((error) => {
    console.error('\n[31m✗ Seed failed:[0m', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
