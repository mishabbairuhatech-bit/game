import { Injectable, Logger } from '@nestjs/common';
import {
  LedgerReason,
  NotificationType,
  PlotAcquisition,
  PlotStatus,
  Prisma,
  SuspicionKind,
} from '@prisma/client';
import { ErrorCode, ServerEvent, SocketRoom } from '@empire/shared';
import { STARTER_BIOMES, plotDistance, plotNeighbours, WorldGeometry } from '@empire/game-data';
import { checkPlotTransition } from '@empire/game-engine';
import { PrismaService } from '../prisma/prisma.service';
import { GameConfigService } from '../game-config/game-config.service';
import { WalletService } from '../economy/wallet.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../realtime/notifications.service';
import { WorldService, PlotSummary } from './world.service';

export interface TerritoryView {
  empire: { id: string; name: string } | null;
  plots: PlotSummary[];
  /** Bounding box of everything the player owns, in plot coordinates. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** The starter holding - where "My Empire" flies the camera to. */
  home: PlotSummary | null;
  totalPlots: number;
  maxPlots: number;
  canExpand: boolean;
  expansionBlockedReason: string | null;
}

export interface PurchaseResult {
  plot: PlotSummary;
  pricePaid: string;
  coinsRemaining: string;
  transactionId: string;
}

/**
 * Territory ownership.
 *
 * Two operations here are the ones an attacker would go after, so both are
 * written the same defensive way: a guarded `updateMany` that carries every
 * precondition in its WHERE clause, inside a serializable transaction. If the
 * guard matches zero rows, someone else won the race and the whole thing
 * rolls back - there is no window in which two players can be handed the same
 * ground, or in which coins leave a wallet without the plot changing hands.
 */
@Injectable()
export class TerritoryService {
  private readonly logger = new Logger(TerritoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly world: WorldService,
    private readonly config: GameConfigService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly gateway: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  /* ====================================================================== */
  /* Starter allocation                                                      */
  /* ====================================================================== */

  /**
   * Claims a starter holding for a new empire.
   *
   * Idempotent: returns the existing plot id when the empire already owns
   * land, so it is safe to call on every empire read. Returns null when no
   * world exists yet.
   *
   * `tx` is required. Starter allocation must commit or roll back together
   * with the rest of account provisioning - an empire with no land is a
   * player who cannot play.
   */
  async assignStarterTerritory(
    tx: Prisma.TransactionClient,
    userId: string,
    empireId: string,
  ): Promise<string | null> {
    const existing = await tx.plot.findFirst({
      where: { empireId },
      select: { id: true },
    });
    if (existing) return existing.id;

    const world = await tx.world.findFirst({
      where: { status: 'ACTIVE' },
      select: { id: true, width: true, height: true, regionSize: true, zoneSize: true, plotSize: true },
    });
    if (!world) {
      this.logger.debug('no active world yet - starter territory deferred');
      return null;
    }

    const geometry = this.world.geometryOf(world);
    const settings = await this.starterSettings();

    const candidates = await this.findStarterCandidates(tx, world.id, geometry, settings);
    if (candidates.length === 0) {
      this.logger.warn('no suitable starter plot available');
      return null;
    }

    // Try candidates in order. The guarded update is what actually prevents
    // two simultaneous signups landing on the same plot: the second one
    // matches zero rows and moves on to the next candidate.
    for (const candidate of candidates) {
      const claimed = await tx.plot.updateMany({
        where: { id: candidate.id, status: PlotStatus.FREE, ownerId: null },
        data: {
          status: PlotStatus.STARTER,
          ownerId: userId,
          empireId,
          acquiredAt: new Date(),
          isForSale: false,
          protectedUntil: new Date(Date.now() + settings.protectionHours * 3_600_000),
        },
      });

      if (claimed.count === 0) continue;

      await tx.plotOwnership.create({
        data: {
          plotId: candidate.id,
          userId,
          empireId,
          previousOwnerId: null,
          acquisition: PlotAcquisition.STARTER_GRANT,
          pricePaid: 0n,
        },
      });

      this.logger.log(
        `starter holding ${candidate.code} (${candidate.x},${candidate.y}) granted to ${userId}`,
      );
      return candidate.id;
    }

    this.logger.warn(
      `all ${candidates.length} starter candidates were taken concurrently - deferring`,
    );
    return null;
  }

  private async starterSettings() {
    const cfg = await this.config.getMany([
      'starter.minDistancePlots',
      'starter.spawnMarginPlots',
      'starter.maxSearchCandidates',
      'starter.protectionHours',
    ]);
    const num = (key: string, fallback: number) => {
      const parsed = Number(cfg[key]);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    };
    return {
      minDistance: num('starter.minDistancePlots', 6),
      margin: num('starter.spawnMarginPlots', 5),
      maxCandidates: num('starter.maxSearchCandidates', 400),
      protectionHours: num('starter.protectionHours', 72),
    };
  }

  /**
   * Picks candidate starter plots, spread across the world.
   *
   * Two requirements pull against each other: players should not all spawn on
   * top of each other, and allocation must not scan 10 000 rows on every
   * signup. The compromise is to fetch a bounded pool of eligible plots in a
   * pseudo-random order, then filter it in memory against existing holdings -
   * one indexed query plus one small query, regardless of world size.
   *
   * If nothing satisfies the distance rule the constraint is relaxed rather
   * than failing: a crowded world should still admit new players.
   */
  private async findStarterCandidates(
    tx: Prisma.TransactionClient,
    worldId: string,
    geometry: WorldGeometry,
    settings: { minDistance: number; margin: number; maxCandidates: number },
  ): Promise<{ id: string; code: string; x: number; y: number }[]> {
    const perSide = geometry.width / geometry.plotSize;
    const min = settings.margin;
    const max = perSide - 1 - settings.margin;

    // Eligible ground: free, buildable, and a biome a new player can actually
    // build a keep on. `md5(id)` gives a stable but arbitrary order so
    // concurrent signups walk different candidates first, which reduces
    // contention on the guarded update below.
    const pool = await tx.$queryRaw<{ id: string; code: string; x: number; y: number }[]>`
      SELECT id, code, x, y
      FROM plots
      WHERE world_id = ${worldId}::uuid
        AND status = 'FREE'
        AND is_buildable = true
        AND owner_id IS NULL
        AND x BETWEEN ${min} AND ${max}
        AND y BETWEEN ${min} AND ${max}
        AND biome = ANY(${STARTER_BIOMES}::"Biome"[])
        AND water_coverage_bps <= 1500
      ORDER BY md5(id::text || ${Date.now().toString()})
      LIMIT ${settings.maxCandidates}
    `;

    if (pool.length === 0) return [];

    const taken = await tx.plot.findMany({
      where: { worldId, ownerId: { not: null } },
      select: { x: true, y: true },
    });

    const farEnough = pool.filter((candidate) =>
      taken.every(
        (t) => plotDistance({ x: candidate.x, y: candidate.y }, t) >= settings.minDistance,
      ),
    );

    if (farEnough.length > 0) return farEnough;

    // World is crowded. Fall back to the least-crowded candidates rather than
    // refusing to let anyone else join.
    this.logger.warn(
      `no starter plot satisfies minDistance=${settings.minDistance}; relaxing the constraint`,
    );
    return [...pool]
      .map((candidate) => ({
        candidate,
        nearest: taken.reduce(
          (best, t) =>
            Math.min(best, plotDistance({ x: candidate.x, y: candidate.y }, t)),
          Number.POSITIVE_INFINITY,
        ),
      }))
      .sort((a, b) => b.nearest - a.nearest)
      .map((entry) => entry.candidate);
  }

  /* ====================================================================== */
  /* Player territory                                                        */
  /* ====================================================================== */

  async getMyTerritory(userId: string): Promise<TerritoryView> {
    const world = await this.world.getActiveWorld();

    const [empire, plots, maxPlots, minHqLevel] = await Promise.all([
      this.prisma.empire.findUnique({
        where: { userId },
        select: { id: true, name: true, hqLevel: true, lastPlotBuyAt: true },
      }),
      this.prisma.plot.findMany({
        where: { worldId: world.id, ownerId: userId },
        select: {
          id: true,
          code: true,
          x: true,
          y: true,
          biome: true,
          status: true,
          price: true,
          isForSale: true,
          isBuildable: true,
          owner: { select: { username: true } },
        },
        orderBy: [{ status: 'asc' }, { y: 'asc' }, { x: 'asc' }],
      }),
      this.config.getInt('land.maxPlotsPerPlayer', 12),
      this.config.getInt('land.minHqLevelToExpand', 3),
    ]);

    const summaries = plots.map((p) => ({
      id: p.id,
      code: p.code,
      x: p.x,
      y: p.y,
      biome: p.biome,
      status: p.status,
      price: p.price.toString(),
      isForSale: p.isForSale,
      isBuildable: p.isBuildable,
      ownerName: p.owner?.username ?? null,
      isMine: true,
    }));

    const bounds =
      plots.length > 0
        ? {
            minX: Math.min(...plots.map((p) => p.x)),
            minY: Math.min(...plots.map((p) => p.y)),
            maxX: Math.max(...plots.map((p) => p.x)),
            maxY: Math.max(...plots.map((p) => p.y)),
          }
        : null;

    const home = summaries.find((p) => p.status === 'STARTER') ?? summaries[0] ?? null;

    let expansionBlockedReason: string | null = null;
    if (!empire) expansionBlockedReason = 'This account has no empire.';
    else if (plots.length >= maxPlots) {
      expansionBlockedReason = `You already hold the maximum of ${maxPlots} plots.`;
    } else if (plots.length > 0 && empire.hqLevel < minHqLevel) {
      expansionBlockedReason = `Headquarters level ${minHqLevel} is required to claim more land.`;
    }

    return {
      empire: empire ? { id: empire.id, name: empire.name } : null,
      plots: summaries,
      bounds,
      home,
      totalPlots: plots.length,
      maxPlots,
      canExpand: expansionBlockedReason === null,
      expansionBlockedReason,
    };
  }

  /**
   * Free plots the player could actually claim next.
   *
   * This is the expansion shortlist the map renders as "available". It must
   * agree exactly with what `purchaseFreePlot` will accept - a shortlist that
   * includes plots the purchase endpoint refuses is a Buy button that fails,
   * which is worse than not offering it.
   *
   * So when the adjacency rule is on, only orthogonal neighbours are returned
   * (the purchase check is Manhattan distance 1, which excludes diagonals).
   * When it is off, a square ring is used instead.
   */
  async getNearbyExpansion(userId: string, radius = 2): Promise<PlotSummary[]> {
    const world = await this.world.getActiveWorld();
    const requireAdjacency = await this.config.getBoolean('land.requireAdjacency', true);

    const owned = await this.prisma.plot.findMany({
      where: { worldId: world.id, ownerId: userId },
      select: { x: true, y: true },
    });
    if (owned.length === 0) return [];

    const wanted = new Set<string>();

    if (requireAdjacency) {
      // Exactly the set the purchase endpoint accepts: orthogonal only.
      for (const plot of owned) {
        for (const n of [
          { x: plot.x + 1, y: plot.y },
          { x: plot.x - 1, y: plot.y },
          { x: plot.x, y: plot.y + 1 },
          { x: plot.x, y: plot.y - 1 },
        ]) {
          if (n.x >= 0 && n.y >= 0) wanted.add(`${n.x}:${n.y}`);
        }
      }
    } else {
      const clampedRadius = Math.max(1, Math.min(4, radius));
      for (const plot of owned) {
        for (let dx = -clampedRadius; dx <= clampedRadius; dx++) {
          for (let dy = -clampedRadius; dy <= clampedRadius; dy++) {
            if (dx === 0 && dy === 0) continue;
            const x = plot.x + dx;
            const y = plot.y + dy;
            if (x >= 0 && y >= 0) wanted.add(`${x}:${y}`);
          }
        }
      }
    }

    for (const plot of owned) wanted.delete(`${plot.x}:${plot.y}`);
    if (wanted.size === 0) return [];

    const coords = [...wanted].map((key) => {
      const [x, y] = key.split(':').map(Number);
      return { x: x as number, y: y as number };
    });

    const plots = await this.prisma.plot.findMany({
      where: {
        worldId: world.id,
        status: PlotStatus.FREE,
        OR: coords.map((c) => ({ x: c.x, y: c.y })),
      },
      select: {
        id: true,
        code: true,
        x: true,
        y: true,
        biome: true,
        status: true,
        price: true,
        isForSale: true,
        isBuildable: true,
      },
      orderBy: [{ price: 'asc' }],
      take: 60,
    });

    return plots.map((p) => ({
      id: p.id,
      code: p.code,
      x: p.x,
      y: p.y,
      biome: p.biome,
      status: p.status,
      price: p.price.toString(),
      isForSale: p.isForSale,
      isBuildable: p.isBuildable,
      ownerName: null,
      isMine: false,
    }));
  }

  /* ====================================================================== */
  /* Expansion purchase                                                      */
  /* ====================================================================== */

  /**
   * Buys a FREE plot from the world.
   *
   * Everything the client sends is a plot id. Price, eligibility, adjacency
   * and the balance change are all determined server-side; a client that
   * posts its own price or owner id is answered with a validation error, not
   * a discount.
   */
  async purchaseFreePlot(
    userId: string,
    plotId: string,
    context: { ip?: string | null; userAgent?: string | null; requestId?: string | null },
  ): Promise<PurchaseResult> {
    const world = await this.world.getActiveWorld();

    const [maxPlots, minHqLevel, requireAdjacency, cooldownSeconds] = await Promise.all([
      this.config.getInt('land.maxPlotsPerPlayer', 12),
      this.config.getInt('land.minHqLevelToExpand', 3),
      this.config.getBoolean('land.requireAdjacency', true),
      this.config.getInt('land.purchaseCooldownSeconds', 300),
    ]);

    const result = await this.prisma.transactWithRetry(async (tx) => {
      /* -- 1. the buyer ------------------------------------------------- */
      const empire = await tx.empire.findUnique({
        where: { userId },
        select: { id: true, hqLevel: true, lastPlotBuyAt: true },
      });
      if (!empire) {
        throw AppException.badRequest(ErrorCode.NOT_FOUND, 'This account has no empire.');
      }

      if (empire.lastPlotBuyAt && cooldownSeconds > 0) {
        const elapsed = Date.now() - empire.lastPlotBuyAt.getTime();
        if (elapsed < cooldownSeconds * 1000) {
          const wait = Math.ceil((cooldownSeconds * 1000 - elapsed) / 1000);
          throw AppException.badRequest(
            ErrorCode.PLOT_PURCHASE_COOLDOWN,
            `You can claim more land in ${wait} second${wait === 1 ? '' : 's'}.`,
          );
        }
      }

      /* -- 2. the plot --------------------------------------------------- */
      const plot = await tx.plot.findUnique({
        where: { id: plotId },
        select: {
          id: true,
          code: true,
          worldId: true,
          x: true,
          y: true,
          biome: true,
          status: true,
          price: true,
          ownerId: true,
          isBuildable: true,
          lockedUntil: true,
        },
      });
      if (!plot) throw AppException.notFound(ErrorCode.PLOT_NOT_FOUND);
      if (plot.worldId !== world.id) {
        throw AppException.badRequest(ErrorCode.PLOT_NOT_AVAILABLE, 'That plot is in another world.');
      }

      // The state machine owns what is and is not a legal move.
      //
      // The HTTP status distinguishes two genuinely different situations, so a
      // client can act on it rather than guessing:
      //
      //   400 - this ground can never be bought (water, mountain: a terminal
      //         state). Retrying, here or later, will never work.
      //   409 - not available *right now* (held by someone else, locked, or
      //         reserved for an event). The state may change; try elsewhere.
      const transition = checkPlotTransition(plot.status, PlotStatus.OWNED, 'WORLD_PURCHASE');
      if (!transition.allowed) {
        const message = transition.message ?? 'That plot is not for sale by the world.';
        throw transition.refusal === 'TERMINAL_STATE'
          ? AppException.badRequest(ErrorCode.PLOT_NOT_AVAILABLE, message)
          : AppException.conflict(ErrorCode.PLOT_NOT_AVAILABLE, message);
      }
      if (plot.ownerId !== null) {
        throw AppException.conflict(
          ErrorCode.PLOT_NOT_AVAILABLE,
          'Another commander already holds that plot.',
        );
      }
      if (plot.lockedUntil && plot.lockedUntil.getTime() > Date.now()) {
        throw AppException.conflict(ErrorCode.PLOT_LOCKED, 'That plot is temporarily locked.');
      }

      /* -- 3. holdings, level and adjacency ------------------------------ */
      const owned = await tx.plot.findMany({
        where: { worldId: world.id, ownerId: userId },
        select: { x: true, y: true },
      });

      if (owned.length >= maxPlots) {
        throw AppException.badRequest(
          ErrorCode.PLOT_LIMIT_REACHED,
          `You already hold the maximum of ${maxPlots} plots.`,
        );
      }
      if (owned.length > 0 && empire.hqLevel < minHqLevel) {
        throw AppException.badRequest(
          ErrorCode.HQ_LEVEL_REQUIRED,
          `Headquarters level ${minHqLevel} is required to claim more land.`,
        );
      }
      if (requireAdjacency && owned.length > 0) {
        const touches = owned.some(
          (o) => Math.abs(o.x - plot.x) + Math.abs(o.y - plot.y) === 1,
        );
        if (!touches) {
          throw AppException.badRequest(
            ErrorCode.PLOT_NOT_ADJACENT,
            'New territory must border land you already hold.',
          );
        }
      }

      /* -- 4. money ------------------------------------------------------ */
      // The price comes from the row, never from the request.
      const price = plot.price;
      if (price <= 0n) {
        throw AppException.badRequest(ErrorCode.PLOT_NOT_AVAILABLE, 'That plot has no world price.');
      }

      const balanceAfter = await this.wallet.debit(
        {
          userId,
          currency: 'COINS',
          amount: price,
          reason: LedgerReason.PLOT_PURCHASE_WORLD,
          metadata: { plotId: plot.id, plotCode: plot.code, x: plot.x, y: plot.y },
          insufficientCode: ErrorCode.INSUFFICIENT_COINS,
        },
        tx,
      );

      /* -- 5. transfer --------------------------------------------------- */
      // Guarded: the status and null owner are re-asserted in the WHERE
      // clause, so a concurrent buyer who got past step 2 still loses here.
      const claimed = await tx.plot.updateMany({
        where: { id: plot.id, status: PlotStatus.FREE, ownerId: null },
        data: {
          status: PlotStatus.OWNED,
          ownerId: userId,
          empireId: empire.id,
          acquiredAt: new Date(),
          isForSale: false,
        },
      });

      if (claimed.count === 0) {
        // Rolls back the debit with it.
        throw AppException.conflict(
          ErrorCode.PLOT_NOT_AVAILABLE,
          'Another commander claimed that plot a moment ago.',
        );
      }

      /* -- 6. trail ------------------------------------------------------ */
      const ledgerEntry = await tx.currencyTransaction.findFirst({
        where: { userId, reason: LedgerReason.PLOT_PURCHASE_WORLD },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      await tx.plotOwnership.create({
        data: {
          plotId: plot.id,
          userId,
          empireId: empire.id,
          previousOwnerId: null,
          acquisition: PlotAcquisition.WORLD_PURCHASE,
          pricePaid: price,
          transactionId: ledgerEntry?.id ?? null,
        },
      });

      await tx.empire.update({
        where: { id: empire.id },
        data: { lastPlotBuyAt: new Date() },
      });

      return {
        plotId: plot.id,
        code: plot.code,
        x: plot.x,
        y: plot.y,
        biome: plot.biome,
        isBuildable: plot.isBuildable,
        price,
        balanceAfter,
        transactionId: ledgerEntry?.id ?? '',
        zoneLookupId: plot.id,
      };
    });

    /* -- 7. side effects, outside the transaction ------------------------ */
    await this.audit.user('land.purchase', userId, {
      entityType: 'Plot',
      entityId: result.plotId,
      after: { code: result.code, price: result.price.toString() },
      ipAddress: context.ip,
      userAgent: context.userAgent,
      requestId: context.requestId,
    });

    await this.notifications
      .notify({
        userId,
        type: NotificationType.PLOT_PURCHASED,
        title: 'Territory claimed',
        body: `${result.code} is now part of your empire.`,
        data: { plotId: result.plotId, x: result.x, y: result.y },
      })
      .catch(() => undefined);

    await this.broadcastPlotChange(result.plotId).catch(() => undefined);

    return {
      plot: {
        id: result.plotId,
        code: result.code,
        x: result.x,
        y: result.y,
        biome: result.biome,
        status: PlotStatus.OWNED,
        price: result.price.toString(),
        isForSale: false,
        isBuildable: result.isBuildable,
        ownerName: null,
        isMine: true,
      },
      pricePaid: result.price.toString(),
      coinsRemaining: result.balanceAfter.toString(),
      transactionId: result.transactionId,
    };
  }

  /**
   * Tells everyone watching that zone that the plot changed hands.
   *
   * Fire-and-forget: a failed broadcast must never undo a committed purchase,
   * and any client that missed it re-reads the viewport on its next pan.
   */
  private async broadcastPlotChange(plotId: string): Promise<void> {
    const plot = await this.prisma.plot.findUnique({
      where: { id: plotId },
      select: {
        id: true,
        code: true,
        x: true,
        y: true,
        status: true,
        zoneId: true,
        owner: { select: { username: true } },
      },
    });
    if (!plot) return;

    this.gateway.toZone(plot.zoneId, ServerEvent.PLOT_UPDATED, {
      id: plot.id,
      code: plot.code,
      x: plot.x,
      y: plot.y,
      status: plot.status,
      ownerName: plot.owner?.username ?? null,
    });
  }

  /* ====================================================================== */
  /* Anti-cheat helper                                                       */
  /* ====================================================================== */

  /** Records an attempt to act on land the caller does not own. */
  async flagUnauthorisedPlotAccess(
    userId: string,
    plotId: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.flagSuspicious({
      userId,
      kind: SuspicionKind.CLIENT_TAMPERING,
      severity: 5,
      details: { plotId, ...detail },
    });
  }

  /** Exposed for tests and for the Phase 6 marketplace. */
  static adjacentTo(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  }

  /** Re-exported so callers do not need to reach into @empire/game-data. */
  static neighbours = plotNeighbours;
  static roomFor = SocketRoom.zone;
}
