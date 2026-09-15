import { Injectable, Logger } from '@nestjs/common';
import { Biome, PlotStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '@empire/shared';
import {
  MAX_VIEWPORT_PLOTS,
  TERRAIN_RULES,
  clampBounds,
  parsePlotCode,
  worldCounts,
  WorldGeometry,
} from '@empire/game-data';
import { PLOT_STATUS_LABEL } from '@empire/game-engine';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AppException } from '../common/errors/app.exception';

/* -------------------------------------------------------------------------- */
/* View models                                                                 */
/* -------------------------------------------------------------------------- */

export interface WorldView {
  id: string;
  slug: string;
  name: string;
  /** The seed is public: terrain is not a secret, and exposing it lets the
   *  client regenerate sub-plot detail locally instead of downloading it. */
  seed: string;
  width: number;
  height: number;
  regionSize: number;
  zoneSize: number;
  plotSize: number;
  status: string;
  counts: {
    regionsPerSide: number;
    zonesPerSide: number;
    plotsPerSide: number;
    totalRegions: number;
    totalZones: number;
    totalPlots: number;
  };
  statistics: {
    claimedPlots: number;
    freePlots: number;
    unavailablePlots: number;
  };
  generatedAt: string | null;
}

export interface RegionView {
  id: string;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  width: number;
  height: number;
  name: string;
  biome: Biome;
  priceModifierBps: number;
}

export interface ZoneView {
  id: string;
  regionId: string;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  width: number;
  height: number;
  biome: Biome;
  isOpen: boolean;
}

/** Compact plot shape for the map. Deliberately small - thousands are sent. */
export interface PlotSummary {
  id: string;
  code: string;
  x: number;
  y: number;
  biome: Biome;
  status: PlotStatus;
  /** Coin price, as a string - prices are BigInt. */
  price: string;
  isForSale: boolean;
  isBuildable: boolean;
  /** Present only when the plot is owned. Public display name only. */
  ownerName: string | null;
  /** True when the requesting player owns it. */
  isMine: boolean;
}

export interface PlotDetail extends PlotSummary {
  regionId: string;
  zoneId: string;
  regionName: string;
  width: number;
  height: number;
  tileX: number;
  tileY: number;
  terrain: {
    label: string;
    description: string;
    buildability: string;
    glyph: string;
    pattern: string;
    color: string;
    /** Fraction of the plot lost to water or rock, in basis points. */
    unbuildableBps: number;
    usableTiles: number;
  };
  statusLabel: string;
  isProtected: boolean;
  protectedUntil: string | null;
  buildingCount: number;
  /** What the requesting player may do with this plot, computed server-side. */
  actions: {
    canView: boolean;
    canVisit: boolean;
    canBuy: boolean;
    /** Why `canBuy` is false, when it is. */
    buyBlockedReason: string | null;
  };
}

export interface ViewportQuery {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  status?: PlotStatus[];
  biome?: Biome[];
  regionId?: string;
  zoneId?: string;
}

export interface ViewportResult {
  plots: PlotSummary[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  total: number;
  truncated: boolean;
}

/**
 * The exact column set PlotSummary needs.
 *
 * Kept as a constant so every list endpoint projects identically, and so it is
 * obvious that `terrain` is deliberately excluded.
 */
const PLOT_SUMMARY_SELECT = {
  id: true,
  code: true,
  x: true,
  y: true,
  biome: true,
  status: true,
  price: true,
  isForSale: true,
  isBuildable: true,
  ownerId: true,
  owner: { select: { username: true } },
} as const;

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

@Injectable()
export class WorldService {
  private readonly logger = new Logger(WorldService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /* ---- world ------------------------------------------------------------ */

  /** The active world, or a structured 404 when none has been generated. */
  async getActiveWorld() {
    const world = await this.prisma.world.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });

    if (!world) {
      throw AppException.notFound(
        ErrorCode.NOT_FOUND,
        'No world has been generated yet. Run the seed to create one.',
      );
    }
    return world;
  }

  geometryOf(world: {
    width: number;
    height: number;
    regionSize: number;
    zoneSize: number;
    plotSize: number;
  }): WorldGeometry {
    return {
      width: world.width,
      height: world.height,
      regionSize: world.regionSize,
      zoneSize: world.zoneSize,
      plotSize: world.plotSize,
    };
  }

  /**
   * World metadata plus occupancy counters.
   *
   * Cached for 30s: the counters are three aggregate scans and every client
   * requests this on load, but the numbers only need to be roughly current.
   */
  async describeWorld(): Promise<WorldView> {
    const world = await this.getActiveWorld();
    const geometry = this.geometryOf(world);
    const counts = worldCounts(geometry);

    const statistics = await this.redis.remember(
      `world:${world.id}:stats`,
      30,
      async () => {
        const grouped = await this.prisma.plot.groupBy({
          by: ['status'],
          where: { worldId: world.id },
          _count: { _all: true },
        });
        const by = (s: PlotStatus) =>
          grouped.find((g) => g.status === s)?._count._all ?? 0;

        return {
          freePlots: by('FREE'),
          unavailablePlots: by('UNAVAILABLE'),
          claimedPlots:
            by('OWNED') + by('STARTER') + by('FOR_SALE') + by('PROTECTED'),
        };
      },
    );

    return {
      id: world.id,
      slug: world.slug,
      name: world.name,
      seed: world.seed,
      width: world.width,
      height: world.height,
      regionSize: world.regionSize,
      zoneSize: world.zoneSize,
      plotSize: world.plotSize,
      status: world.status,
      counts: {
        regionsPerSide: counts.regionsPerSide,
        zonesPerSide: counts.zonesPerSide,
        plotsPerSide: counts.plotsPerSide,
        totalRegions: counts.totalRegions,
        totalZones: counts.totalZones,
        totalPlots: counts.totalPlots,
      },
      statistics,
      generatedAt: world.generatedAt?.toISOString() ?? null,
    };
  }

  /* ---- regions and zones ------------------------------------------------- */

  /**
   * All regions. Bounded by construction - a 1000-tile world has 100 of them,
   * and even a very large world has only a few thousand, which is exactly the
   * summary a zoomed-out map needs.
   */
  async listRegions(biome?: Biome[]): Promise<RegionView[]> {
    const world = await this.getActiveWorld();
    const regions = await this.prisma.region.findMany({
      where: { worldId: world.id, ...(biome?.length ? { biome: { in: biome } } : {}) },
      orderBy: [{ y: 'asc' }, { x: 'asc' }],
    });
    return regions.map((r) => this.toRegionView(r));
  }

  async getRegion(regionId: string) {
    const region = await this.prisma.region.findUnique({
      where: { id: regionId },
      include: {
        _count: { select: { zones: true, plots: true } },
      },
    });
    if (!region) throw AppException.notFound(ErrorCode.NOT_FOUND, 'No such region.');

    const [free, claimed] = await Promise.all([
      this.prisma.plot.count({ where: { regionId, status: 'FREE' } }),
      this.prisma.plot.count({
        where: { regionId, status: { in: ['OWNED', 'STARTER', 'FOR_SALE', 'PROTECTED'] } },
      }),
    ]);

    return {
      ...this.toRegionView(region),
      zoneCount: region._count.zones,
      plotCount: region._count.plots,
      freePlots: free,
      claimedPlots: claimed,
    };
  }

  async listZonesInRegion(regionId: string): Promise<ZoneView[]> {
    const exists = await this.prisma.region.findUnique({
      where: { id: regionId },
      select: { id: true },
    });
    if (!exists) throw AppException.notFound(ErrorCode.NOT_FOUND, 'No such region.');

    const zones = await this.prisma.zone.findMany({
      where: { regionId },
      orderBy: [{ y: 'asc' }, { x: 'asc' }],
    });
    return zones.map((z) => this.toZoneView(z));
  }

  async getZone(zoneId: string) {
    const zone = await this.prisma.zone.findUnique({
      where: { id: zoneId },
      include: { region: { select: { id: true, name: true } } },
    });
    if (!zone) throw AppException.notFound(ErrorCode.NOT_FOUND, 'No such zone.');

    const plots = await this.prisma.plot.findMany({
      where: { zoneId },
      orderBy: [{ y: 'asc' }, { x: 'asc' }],
      select: PLOT_SUMMARY_SELECT,
    });

    return {
      ...this.toZoneView(zone),
      regionName: zone.region.name,
      plots: plots.map((p) => this.toPlotSummary(p, null)),
    };
  }

  /* ---- viewport ---------------------------------------------------------- */

  /**
   * Plots inside a bounding box.
   *
   * The bounds are clamped to the world and to MAX_VIEWPORT_PLOTS before the
   * query runs, so no request - however crafted - can ask the database for the
   * whole world. `truncated` tells the client its viewport was narrowed, so it
   * can zoom out to region summaries instead of silently showing partial data.
   */
  async queryViewport(query: ViewportQuery, viewerId: string | null): Promise<ViewportResult> {
    const world = await this.getActiveWorld();
    const geometry = this.geometryOf(world);

    const { bounds, truncated } = clampBounds(
      geometry,
      { minX: query.minX, minY: query.minY, maxX: query.maxX, maxY: query.maxY },
      MAX_VIEWPORT_PLOTS,
    );

    const where: Prisma.PlotWhereInput = {
      worldId: world.id,
      x: { gte: bounds.minX, lte: bounds.maxX },
      y: { gte: bounds.minY, lte: bounds.maxY },
      ...(query.status?.length ? { status: { in: query.status } } : {}),
      ...(query.biome?.length ? { biome: { in: query.biome } } : {}),
      ...(query.regionId ? { regionId: query.regionId } : {}),
      ...(query.zoneId ? { zoneId: query.zoneId } : {}),
    };

    // Select only what PlotSummary needs. The default projection pulls every
    // column including the per-plot `terrain` JSON, which for 2 500 rows turns
    // a millisecond index scan into a multi-second serialisation job - the map
    // never reads that blob, it regenerates the detail from the world seed.
    const plots = await this.prisma.plot.findMany({
      where,
      orderBy: [{ y: 'asc' }, { x: 'asc' }],
      take: MAX_VIEWPORT_PLOTS,
      select: PLOT_SUMMARY_SELECT,
    });

    return {
      plots: plots.map((p) => this.toPlotSummary(p, viewerId)),
      bounds,
      total: plots.length,
      truncated,
    };
  }

  /* ---- plot detail -------------------------------------------------------- */

  /** Accepts either a plot UUID or a plot code such as `R3-4:Z18-22:P92-113`. */
  async getPlotDetail(idOrCode: string, viewerId: string | null): Promise<PlotDetail> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);

    const plot = await this.prisma.plot.findFirst({
      where: isUuid ? { id: idOrCode } : { code: idOrCode },
      include: {
        owner: { select: { id: true, username: true } },
        region: { select: { id: true, name: true } },
        _count: { select: { buildings: true } },
      },
    });

    if (!plot) throw AppException.notFound(ErrorCode.PLOT_NOT_FOUND);

    const rule = TERRAIN_RULES[plot.biome];
    const summary = this.toPlotSummary(plot, viewerId);
    const now = new Date();
    const isProtected =
      plot.protectedUntil !== null && plot.protectedUntil.getTime() > now.getTime();

    return {
      ...summary,
      regionId: plot.regionId,
      zoneId: plot.zoneId,
      regionName: plot.region.name,
      width: plot.width,
      height: plot.height,
      tileX: plot.tileX,
      tileY: plot.tileY,
      terrain: {
        label: rule.label,
        description: rule.description,
        buildability: rule.buildability,
        glyph: rule.glyph,
        pattern: rule.pattern,
        color: rule.color,
        unbuildableBps: plot.waterCoverageBps,
        usableTiles: Math.floor(
          (plot.width * plot.height * (10000 - plot.waterCoverageBps)) / 10000,
        ),
      },
      statusLabel: PLOT_STATUS_LABEL[plot.status],
      isProtected,
      protectedUntil: plot.protectedUntil?.toISOString() ?? null,
      buildingCount: plot._count.buildings,
      actions: this.actionsFor(plot, viewerId),
    };
  }

  /**
   * What the viewer may do with a plot.
   *
   * Computed here rather than in the client so the UI cannot offer an action
   * the server would refuse - and so the reason for a refusal is explainable
   * rather than a button that silently does nothing.
   */
  private actionsFor(
    plot: { status: PlotStatus; ownerId: string | null; isBuildable: boolean },
    viewerId: string | null,
  ): PlotDetail['actions'] {
    const isMine = viewerId !== null && plot.ownerId === viewerId;

    let buyBlockedReason: string | null = null;
    if (!viewerId) buyBlockedReason = 'Sign in to claim land.';
    else if (isMine) buyBlockedReason = 'You already hold this plot.';
    else if (plot.status === 'UNAVAILABLE') buyBlockedReason = 'This ground cannot be claimed.';
    else if (plot.status === 'LOCKED') buyBlockedReason = 'This plot is locked.';
    else if (plot.status === 'EVENT') buyBlockedReason = 'This plot is reserved for an event.';
    else if (plot.status === 'FOR_SALE') {
      buyBlockedReason = 'Listed by its owner. Player-to-player sales open in a later phase.';
    } else if (plot.ownerId) buyBlockedReason = 'Another commander holds this plot.';

    return {
      canView: true,
      canVisit: plot.ownerId !== null,
      canBuy: buyBlockedReason === null && plot.status === 'FREE',
      buyBlockedReason,
    };
  }

  /* ---- search ------------------------------------------------------------- */

  /**
   * Map search across plot codes, coordinates and commander names.
   *
   * Returns plot references rather than raw player records, because the map's
   * only use for a name is "take me to their land".
   */
  async search(term: string, viewerId: string | null) {
    const world = await this.getActiveWorld();
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      return { plots: [] as PlotSummary[], players: [] as { username: string; plotCode: string }[] };
    }

    // "12,34" or "12 34" - a direct coordinate jump.
    const coord = /^(\d{1,5})\s*[,: ]\s*(\d{1,5})$/.exec(trimmed);
    const parsedCode = parsePlotCode(trimmed);
    const target = coord
      ? { x: Number(coord[1]), y: Number(coord[2]) }
      : parsedCode
        ? { x: parsedCode.plotX, y: parsedCode.plotY }
        : null;

    if (target) {
      const plot = await this.prisma.plot.findFirst({
        where: { worldId: world.id, x: target.x, y: target.y },
        select: PLOT_SUMMARY_SELECT,
      });
      return {
        plots: plot ? [this.toPlotSummary(plot, viewerId)] : [],
        players: [],
      };
    }

    // Otherwise treat it as a commander name and return their holdings.
    const owners = await this.prisma.user.findMany({
      where: { username: { contains: trimmed, mode: 'insensitive' }, deletedAt: null },
      select: { id: true, username: true },
      take: 5,
    });

    if (owners.length === 0) return { plots: [], players: [] };

    const plots = await this.prisma.plot.findMany({
      where: { worldId: world.id, ownerId: { in: owners.map((o) => o.id) } },
      select: PLOT_SUMMARY_SELECT,
      orderBy: [{ status: 'asc' }, { y: 'asc' }, { x: 'asc' }],
      take: 40,
    });

    return {
      plots: plots.map((p) => this.toPlotSummary(p, viewerId)),
      players: owners.map((o) => ({
        username: o.username,
        plotCode: plots.find((p) => p.ownerId === o.id)?.code ?? '',
      })),
    };
  }

  /* ---- mappers ------------------------------------------------------------ */

  private toRegionView(r: {
    id: string;
    x: number;
    y: number;
    tileX: number;
    tileY: number;
    width: number;
    height: number;
    name: string;
    biome: Biome;
    priceModifierBps: number;
  }): RegionView {
    return {
      id: r.id,
      x: r.x,
      y: r.y,
      tileX: r.tileX,
      tileY: r.tileY,
      width: r.width,
      height: r.height,
      name: r.name,
      biome: r.biome,
      priceModifierBps: r.priceModifierBps,
    };
  }

  private toZoneView(z: {
    id: string;
    regionId: string;
    x: number;
    y: number;
    tileX: number;
    tileY: number;
    width: number;
    height: number;
    biome: Biome;
    isOpen: boolean;
  }): ZoneView {
    return {
      id: z.id,
      regionId: z.regionId,
      x: z.x,
      y: z.y,
      tileX: z.tileX,
      tileY: z.tileY,
      width: z.width,
      height: z.height,
      biome: z.biome,
      isOpen: z.isOpen,
    };
  }

  private toPlotSummary(
    p: {
      id: string;
      code: string;
      x: number;
      y: number;
      biome: Biome;
      status: PlotStatus;
      price: bigint;
      isForSale: boolean;
      isBuildable: boolean;
      ownerId: string | null;
      owner?: { id?: string; username: string } | null;
    },
    viewerId: string | null,
  ): PlotSummary {
    return {
      id: p.id,
      code: p.code,
      x: p.x,
      y: p.y,
      biome: p.biome,
      status: p.status,
      price: p.price.toString(),
      isForSale: p.isForSale,
      isBuildable: p.isBuildable,
      // Only the public display name is ever exposed - never the owner's id
      // or email, which would let the map enumerate accounts.
      ownerName: p.owner?.username ?? null,
      isMine: viewerId !== null && p.ownerId === viewerId,
    };
  }
}
