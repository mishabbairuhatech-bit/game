import { Injectable, Logger } from '@nestjs/common';
import { Biome, PlotStatus, Prisma, WorldStatus } from '@prisma/client';
import {
  DEFAULT_WORLD_GEOMETRY,
  TERRAIN_RULES,
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
import { PrismaService } from '../prisma/prisma.service';
import { GameConfigService } from '../game-config/game-config.service';

export interface GenerateWorldOptions {
  slug: string;
  name: string;
  seed: string;
  geometry?: Partial<WorldGeometry>;
  /** Re-generate even if a world with this slug already exists. */
  force?: boolean;
}

export interface GenerationReport {
  worldId: string;
  slug: string;
  seed: string;
  geometry: WorldGeometry;
  regions: number;
  zones: number;
  plots: number;
  biomeBreakdown: Record<string, number>;
  claimablePlots: number;
  durationMs: number;
  skipped: boolean;
}

/** Rows are inserted in chunks; one 10k-row statement is slow and memory-hungry. */
const INSERT_CHUNK = 1000;

/**
 * Builds a persistent world from a seed.
 *
 * The generator is deterministic and idempotent: running it twice with the
 * same slug is a no-op, and running it with the same seed on a fresh database
 * produces byte-identical terrain. That property is what lets us store only
 * the seed and regenerate detail on demand, instead of persisting a height
 * value for all million tiles.
 *
 * Only the three grid tiers are persisted. Sub-plot detail (heightmap, prop
 * placement) is recomputed on the client from the plot's seed, so streaming a
 * region costs kilobytes.
 */
@Injectable()
export class WorldGeneratorService {
  private readonly logger = new Logger(WorldGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
  ) {}

  /** Resolves geometry from admin config, falling back to the shipped default. */
  async resolveGeometry(overrides: Partial<WorldGeometry> = {}): Promise<WorldGeometry> {
    const cfg = await this.config.getMany([
      'world.width',
      'world.regionSize',
      'world.zoneSize',
      'world.plotSize',
    ]);

    const num = (key: string, fallback: number) => {
      const parsed = Number(cfg[key]);
      return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
    };

    const width = overrides.width ?? num('world.width', DEFAULT_WORLD_GEOMETRY.width);

    const geometry: WorldGeometry = {
      width,
      // Square worlds only; height mirrors width so the two can never drift.
      height: overrides.height ?? width,
      regionSize: overrides.regionSize ?? num('world.regionSize', DEFAULT_WORLD_GEOMETRY.regionSize),
      zoneSize: overrides.zoneSize ?? num('world.zoneSize', DEFAULT_WORLD_GEOMETRY.zoneSize),
      plotSize: overrides.plotSize ?? num('world.plotSize', DEFAULT_WORLD_GEOMETRY.plotSize),
    };

    validateGeometry(geometry);
    return geometry;
  }

  /**
   * Generates a world if one with this slug does not already exist.
   *
   * Returns `skipped: true` when the world is already present, so this is safe
   * to call from the seed on every container start.
   */
  async generate(options: GenerateWorldOptions): Promise<GenerationReport> {
    const started = Date.now();
    const geometry = await this.resolveGeometry(options.geometry);
    const counts = worldCounts(geometry);

    const existing = await this.prisma.world.findUnique({
      where: { slug: options.slug },
      select: { id: true, seed: true, status: true },
    });

    if (existing && !options.force) {
      const plots = await this.prisma.plot.count({ where: { worldId: existing.id } });
      this.logger.log(`world "${options.slug}" already exists with ${plots} plots - skipping`);
      return {
        worldId: existing.id,
        slug: options.slug,
        seed: existing.seed,
        geometry,
        regions: await this.prisma.region.count({ where: { worldId: existing.id } }),
        zones: await this.prisma.zone.count({ where: { worldId: existing.id } }),
        plots,
        biomeBreakdown: {},
        claimablePlots: 0,
        durationMs: Date.now() - started,
        skipped: true,
      };
    }

    if (existing && options.force) {
      // Cascades to regions, zones and plots. Buildings and ownership rows go
      // with the plots, which is why force is an explicit opt-in.
      this.logger.warn(`force: deleting existing world "${options.slug}" and all its land`);
      await this.prisma.world.delete({ where: { id: existing.id } });
    }

    this.logger.log(
      `generating world "${options.slug}" seed=${options.seed} ` +
        `${geometry.width}x${geometry.height} tiles -> ` +
        `${counts.totalRegions} regions, ${counts.totalZones} zones, ${counts.totalPlots} plots`,
    );

    const params: WorldGenParams = { seed: options.seed, size: geometry.width };

    // The world row is created up front in GENERATING so a crash mid-run
    // leaves an obviously-incomplete world rather than a plausible-looking one.
    const world = await this.prisma.world.create({
      data: {
        slug: options.slug,
        name: options.name,
        seed: options.seed,
        width: geometry.width,
        height: geometry.height,
        regionSize: geometry.regionSize,
        zoneSize: geometry.zoneSize,
        plotSize: geometry.plotSize,
        status: WorldStatus.GENERATING,
      },
    });

    const regionIds = await this.generateRegions(world.id, geometry, params);
    const zoneIds = await this.generateZones(world.id, geometry, params, regionIds);
    const breakdown = await this.generatePlots(world.id, geometry, params, regionIds, zoneIds);

    await this.prisma.world.update({
      where: { id: world.id },
      data: { status: WorldStatus.ACTIVE, generatedAt: new Date() },
    });

    const [claimablePlots, persistedPlots, persistedZones, persistedRegions] =
      await Promise.all([
        this.prisma.plot.count({ where: { worldId: world.id, status: PlotStatus.FREE } }),
        this.prisma.plot.count({ where: { worldId: world.id } }),
        this.prisma.zone.count({ where: { worldId: world.id } }),
        this.prisma.region.count({ where: { worldId: world.id } }),
      ]);

    const durationMs = Date.now() - started;
    this.logger.log(
      `world "${options.slug}" generated in ${durationMs}ms - ${claimablePlots} claimable plots`,
    );

    return {
      worldId: world.id,
      slug: options.slug,
      seed: options.seed,
      geometry,
      // Counted from the database, not derived from the geometry: a report
      // that only echoes the arithmetic cannot reveal a partial write.
      regions: persistedRegions,
      zones: persistedZones,
      plots: persistedPlots,
      biomeBreakdown: breakdown,
      claimablePlots,
      durationMs,
      skipped: false,
    };
  }

  /* ---- tiers ------------------------------------------------------------ */

  private async generateRegions(
    worldId: string,
    g: WorldGeometry,
    params: WorldGenParams,
  ): Promise<Map<string, string>> {
    const { regionsPerSide } = worldCounts(g);
    const rows: Prisma.RegionCreateManyInput[] = [];

    for (let y = 0; y < regionsPerSide; y++) {
      for (let x = 0; x < regionsPerSide; x++) {
        const tileX = x * g.regionSize;
        const tileY = y * g.regionSize;
        const biome = dominantBiome(params, tileX, tileY, g.regionSize);

        rows.push({
          worldId,
          x,
          y,
          width: g.regionSize,
          height: g.regionSize,
          tileX,
          tileY,
          name: regionName(params.seed, x, y),
          seed: `${params.seed}:${regionCode(x, y)}`,
          biome: biome as Biome,
          priceModifierBps: TERRAIN_RULES[biome].priceModifierBps,
        });
      }
    }

    await this.insertChunked('region', rows, (chunk) =>
      this.prisma.region.createMany({ data: chunk, skipDuplicates: true }),
    );

    const created = await this.prisma.region.findMany({
      where: { worldId },
      select: { id: true, x: true, y: true },
    });
    return new Map(created.map((r) => [`${r.x}:${r.y}`, r.id]));
  }

  private async generateZones(
    worldId: string,
    g: WorldGeometry,
    params: WorldGenParams,
    regionIds: Map<string, string>,
  ): Promise<Map<string, string>> {
    const { zonesPerSide } = worldCounts(g);
    const zonesPerRegionSide = g.regionSize / g.zoneSize;
    const rows: Prisma.ZoneCreateManyInput[] = [];

    for (let y = 0; y < zonesPerSide; y++) {
      for (let x = 0; x < zonesPerSide; x++) {
        const regionX = Math.floor(x / zonesPerRegionSide);
        const regionY = Math.floor(y / zonesPerRegionSide);
        const regionId = regionIds.get(`${regionX}:${regionY}`);
        if (!regionId) {
          throw new Error(`Zone ${x},${y} has no parent region ${regionX},${regionY}.`);
        }

        const tileX = x * g.zoneSize;
        const tileY = y * g.zoneSize;

        rows.push({
          worldId,
          regionId,
          x,
          y,
          width: g.zoneSize,
          height: g.zoneSize,
          tileX,
          tileY,
          seed: `${params.seed}:${zoneCode(x, y)}`,
          biome: dominantBiome(params, tileX, tileY, g.zoneSize, 4) as Biome,
          isOpen: true,
        });
      }
    }

    await this.insertChunked('zone', rows, (chunk) =>
      this.prisma.zone.createMany({ data: chunk, skipDuplicates: true }),
    );

    const created = await this.prisma.zone.findMany({
      where: { worldId },
      select: { id: true, x: true, y: true },
    });
    return new Map(created.map((z) => [`${z.x}:${z.y}`, z.id]));
  }

  private async generatePlots(
    worldId: string,
    g: WorldGeometry,
    params: WorldGenParams,
    regionIds: Map<string, string>,
    zoneIds: Map<string, string>,
  ): Promise<Record<string, number>> {
    const { plotsPerSide } = worldCounts(g);
    const basePrice = await this.config.getInt('land.basePlotPrice', 2500);

    const breakdown: Record<string, number> = {};
    const rows: Prisma.PlotCreateManyInput[] = [];
    const centre = plotsPerSide / 2;

    for (let y = 0; y < plotsPerSide; y++) {
      for (let x = 0; x < plotsPerSide; x++) {
        const loc = locatePlot(g, x, y);
        const zoneId = zoneIds.get(`${loc.zoneX}:${loc.zoneY}`);
        const regionId = regionIds.get(`${loc.regionX}:${loc.regionY}`);
        if (!zoneId || !regionId) {
          throw new Error(`Plot ${x},${y} has no parent zone/region.`);
        }

        const terrain = plotTerrain(params, x, y, g.plotSize);
        const biome = dominantBiome(params, loc.tileX, loc.tileY, g.plotSize, 3) as Biome;
        const rule = TERRAIN_RULES[biome];
        const unbuildableBps = unbuildableCoverageBps(params, x, y, g.plotSize);

        breakdown[biome] = (breakdown[biome] ?? 0) + 1;

        // Water and sheer rock are scenery, not inventory: they are never
        // claimable, so they start UNAVAILABLE, which is a terminal state.
        const claimable = isClaimable(biome);
        const status = claimable ? PlotStatus.FREE : PlotStatus.UNAVAILABLE;

        const distanceFromCentre = Math.max(Math.abs(x - centre), Math.abs(y - centre));
        const price = claimable
          ? calculatePlotPrice({
              basePrice,
              biomeModifierBps: rule.priceModifierBps,
              regionModifierBps: 10000,
              unbuildableBps,
              distanceFromCentre,
              plotsPerSide,
            })
          : 0n;

        rows.push({
          worldId,
          regionId,
          zoneId,
          code: plotCode(g, x, y),
          x,
          y,
          width: g.plotSize,
          height: g.plotSize,
          tileX: loc.tileX,
          tileY: loc.tileY,
          biome,
          status,
          isBuildable: rule.buildability !== 'BLOCKED',
          price,
          isForSale: false,
          waterCoverageBps: unbuildableBps,
          terrain: terrain as unknown as Prisma.InputJsonValue,
        });
      }
    }

    await this.insertChunked('plot', rows, (chunk) =>
      this.prisma.plot.createMany({ data: chunk, skipDuplicates: true }),
    );

    return breakdown;
  }

  /**
   * Inserts in chunks and verifies that every row landed.
   *
   * `skipDuplicates` is on so a re-run is idempotent, but that also means a
   * unique-constraint collision is silently discarded. A global unique on
   * `plots.code` once dropped every plot of a second world and reported
   * success - the generation "worked" and produced an empty world. Counting
   * the inserted rows turns that class of bug into an immediate, loud failure
   * instead of a mystery.
   */
  private async insertChunked<T>(
    label: string,
    rows: T[],
    insert: (chunk: T[]) => Promise<{ count: number }>,
  ): Promise<void> {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const result = await insert(rows.slice(i, i + INSERT_CHUNK));
      inserted += result.count;
    }

    if (inserted !== rows.length) {
      throw new Error(
        `World generation inserted ${inserted} of ${rows.length} ${label} rows. ` +
          `The missing rows collided with a unique constraint and were dropped ` +
          `by skipDuplicates - the world would be silently incomplete.`,
      );
    }
  }
}
