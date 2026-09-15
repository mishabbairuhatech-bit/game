import { Injectable, Logger } from '@nestjs/common';
import { LedgerReason, Prisma, User } from '@prisma/client';
import { STARTER_ARMY, STARTER_BUILDINGS, BUILDING_BY_KEY } from '@empire/game-data';
import { GameConfigService } from '../game-config/game-config.service';
import { WalletService } from '../economy/wallet.service';
import { TerritoryService } from '../world/territory.service';

export interface BootstrapOptions {
  empireName: string;
}

/**
 * Everything a brand-new account needs in order to be playable, created inside
 * the same transaction as the User row.
 *
 * Provisions the empire, wallet grant, inventory, starting army and starter
 * territory. Territory is claimed through `assignStarterTerritory`, which is
 * a no-op until a world has been generated - it is called again lazily on the
 * first empire read, so accounts created before the world existed pick up
 * their land automatically rather than needing a backfill migration.
 */
@Injectable()
export class PlayerBootstrapService {
  private readonly logger = new Logger(PlayerBootstrapService.name);

  constructor(
    private readonly config: GameConfigService,
    private readonly wallet: WalletService,
    private readonly territory: TerritoryService,
  ) {}

  async provisionNewPlayer(
    tx: Prisma.TransactionClient,
    user: User,
    options: BootstrapOptions,
  ): Promise<void> {
    const starters = await this.config.getMany([
      'economy.starterCoins',
      'economy.starterGems',
      'economy.starterWood',
      'economy.starterStone',
      'economy.starterFood',
      'economy.starterIron',
      'economy.starterGold',
    ]);

    const num = (key: string, fallback: number) => {
      const parsed = Number(starters[key]);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    };

    // ---- empire ---------------------------------------------------------
    const empire = await tx.empire.create({
      data: {
        userId: user.id,
        name: options.empireName,
        wood: num('economy.starterWood', 1500),
        stone: num('economy.starterStone', 1500),
        food: num('economy.starterFood', 1500),
        iron: num('economy.starterIron', 200),
        gold: num('economy.starterGold', 50),
        // Capacities are recomputed from placed buildings; these are the
        // floor granted by a level 1 headquarters.
        woodCapacity: 2000,
        stoneCapacity: 2000,
        foodCapacity: 2000,
        ironCapacity: 600,
        goldCapacity: 300,
        hqLevel: 1,
        builders: 1,
        populationCap: 20,
        lastAccrualAt: new Date(),
        inventory: { create: {} },
        army: { create: {} },
      },
      include: { army: true },
    });

    // ---- starting army --------------------------------------------------
    if (empire.army) {
      const defs = await tx.unitDefinition.findMany({
        where: { key: { in: STARTER_ARMY.map((u) => u.key) } },
        select: { id: true, key: true, population: true },
      });

      let population = 0;
      for (const starter of STARTER_ARMY) {
        const def = defs.find((d) => d.key === starter.key);
        if (!def) {
          // The seed has not run yet. Skip rather than fail the signup.
          this.logger.warn(`unit definition "${starter.key}" missing - skipping starter troops`);
          continue;
        }
        await tx.armyUnit.create({
          data: { armyId: empire.army.id, definitionId: def.id, count: starter.count },
        });
        population += def.population * starter.count;
      }

      if (population > 0) {
        await tx.empire.update({
          where: { id: empire.id },
          data: { populationUsed: population },
        });
      }
    }

    // ---- currency grant (goes through the ledger like everything else) ---
    const coins = BigInt(num('economy.starterCoins', 5000));
    const gems = BigInt(num('economy.starterGems', 50));

    if (coins > 0n) {
      await this.wallet.credit(
        {
          userId: user.id,
          currency: 'COINS',
          amount: coins,
          reason: LedgerReason.SIGNUP_GRANT,
          metadata: { empireId: empire.id },
          idempotencyKey: `signup:coins:${user.id}`,
        },
        tx,
      );
    }
    if (gems > 0n) {
      await this.wallet.credit(
        {
          userId: user.id,
          currency: 'GEMS',
          amount: gems,
          reason: LedgerReason.SIGNUP_GRANT,
          metadata: { empireId: empire.id },
          idempotencyKey: `signup:gems:${user.id}`,
        },
        tx,
      );
    }

    // ---- territory ------------------------------------------------------
    await this.assignStarterTerritory(tx, user.id, empire.id);
  }

  /**
   * Claims a starter holding and drops the opening buildings on it.
   *
   * The allocation itself - candidate selection, the minimum-distance rule and
   * the guarded claim that stops two signups landing on the same ground -
   * lives in TerritoryService, which owns every plot ownership transition.
   * This method adds the part specific to a *new* empire: the starter base.
   *
   * Idempotent, and a no-op until a world exists. Returns the claimed plot id,
   * or null when nothing could be claimed.
   */
  async assignStarterTerritory(
    tx: Prisma.TransactionClient,
    userId: string,
    empireId: string,
  ): Promise<string | null> {
    const alreadyOwns = await tx.plot.findFirst({
      where: { empireId },
      select: { id: true },
    });
    if (alreadyOwns) return alreadyOwns.id;

    const plotId = await this.territory.assignStarterTerritory(tx, userId, empireId);
    if (!plotId) return null;

    await this.placeStarterBuildings(tx, empireId, plotId);
    return plotId;
  }

  /**
   * Lays out the opening buildings on a fresh plot.
   *
   * The layout is a fixed, hand-tuned arrangement rather than something
   * random, so every new player gets a base that reads clearly and has no
   * overlaps. Players rearrange it from the building editor (Phase 3).
   */
  private async placeStarterBuildings(
    tx: Prisma.TransactionClient,
    empireId: string,
    plotId: string,
  ): Promise<void> {
    const keys = STARTER_BUILDINGS.map((b) => b.key);
    const definitions = await tx.buildingDefinition.findMany({
      where: { key: { in: keys } },
      include: { levels: { where: { level: 1 } } },
    });

    if (definitions.length === 0) {
      this.logger.warn('building definitions missing - starter base not placed');
      return;
    }

    // Read the plot's real extent rather than assuming one: plotSize is
    // configurable, and a layout hard-coded for one size silently places
    // buildings off the edge of a smaller plot.
    const plot = await tx.plot.findUnique({
      where: { id: plotId },
      select: { width: true, height: true, code: true },
    });
    if (!plot) {
      this.logger.warn(`plot ${plotId} vanished before the starter base was placed`);
      return;
    }

    // Origin tiles, laid out for the default 10x10 plot: headquarters in the
    // middle with production at the corners and the tower covering the
    // approach. Verified non-overlapping against the footprints in
    // @empire/game-data.
    const LAYOUT: Record<string, { x: number; y: number }> = {
      headquarters: { x: 3, y: 3 }, // 4x4 -> 3..6
      builder_hut: { x: 0, y: 0 }, // 2x2 -> 0..1
      warehouse: { x: 3, y: 0 }, // 3x3 -> x 3..5, y 0..2
      farm: { x: 7, y: 0 }, // 3x3 -> x 7..9, y 0..2
      barracks: { x: 0, y: 3 }, // 3x3 -> x 0..2, y 3..5
      archer_tower: { x: 7, y: 4 }, // 2x2 -> x 7..8, y 4..5
      lumber_mill: { x: 0, y: 7 }, // 3x3 -> x 0..2, y 7..9
      stone_quarry: { x: 7, y: 7 }, // 3x3 -> x 7..9, y 7..9
    };

    const placed: { x: number; y: number; w: number; h: number; key: string }[] = [];

    for (const starter of STARTER_BUILDINGS) {
      const def = definitions.find((d) => d.key === starter.key);
      const spec = def?.levels[0];
      const at = LAYOUT[starter.key];
      if (!def || !spec || !at) continue;

      const footprint = BUILDING_BY_KEY.get(starter.key)?.footprint;
      if (!footprint) continue;

      // Guard the layout against a smaller plot rather than trusting it. A
      // building that would hang off the edge is skipped and logged; the
      // player still gets a working base, and the gap is visible in the log
      // instead of surfacing later as a phantom building outside the plot.
      if (at.x + footprint.width > plot.width || at.y + footprint.height > plot.height) {
        this.logger.warn(
          `skipping starter ${starter.key} on ${plot.code}: ` +
            `${footprint.width}x${footprint.height} at (${at.x},${at.y}) ` +
            `does not fit a ${plot.width}x${plot.height} plot`,
        );
        continue;
      }

      const overlaps = placed.find(
        (o) =>
          at.x < o.x + o.w &&
          at.x + footprint.width > o.x &&
          at.y < o.y + o.h &&
          at.y + footprint.height > o.y,
      );
      if (overlaps) {
        this.logger.error(
          `starter layout bug: ${starter.key} overlaps ${overlaps.key} on ${plot.code}`,
        );
        continue;
      }

      await tx.building.create({
        data: {
          empireId,
          plotId,
          definitionId: def.id,
          level: starter.level,
          state: 'ACTIVE',
          tileX: at.x,
          tileY: at.y,
          rotation: 0,
          currentHp: spec.hitpoints,
          lastCollectedAt: new Date(),
        },
      });

      placed.push({
        x: at.x,
        y: at.y,
        w: footprint.width,
        h: footprint.height,
        key: starter.key,
      });
    }

    // Recompute derived capacities from what was just placed.
    await this.recomputeCapacities(tx, empireId);
  }

  /**
   * Recalculates storage / population / builder capacity from placed
   * buildings. Called after any construction, upgrade or demolition so the
   * empire row stays a correct cache of the building set.
   */
  async recomputeCapacities(tx: Prisma.TransactionClient, empireId: string): Promise<void> {
    const buildings = await tx.building.findMany({
      where: { empireId, state: { in: ['ACTIVE', 'UPGRADING', 'DAMAGED'] } },
      select: { level: true, definitionId: true },
    });
    if (buildings.length === 0) return;

    const levelRows = await tx.buildingLevel.findMany({
      where: {
        OR: buildings.map((b) => ({ definitionId: b.definitionId, level: b.level })),
      },
      select: { definitionId: true, level: true, storage: true, capacity: true },
    });

    const totals = {
      wood: 0,
      stone: 0,
      food: 0,
      iron: 0,
      gold: 0,
      population: 0,
      builders: 0,
    };

    for (const b of buildings) {
      const row = levelRows.find((l) => l.definitionId === b.definitionId && l.level === b.level);
      if (!row) continue;

      const storage = (row.storage ?? {}) as Record<string, number>;
      totals.wood += storage.WOOD ?? 0;
      totals.stone += storage.STONE ?? 0;
      totals.food += storage.FOOD ?? 0;
      totals.iron += storage.IRON ?? 0;
      totals.gold += storage.GOLD ?? 0;

      const capacity = (row.capacity ?? {}) as Record<string, number>;
      totals.population += capacity.populationCapacity ?? 0;
      totals.builders += capacity.builders ?? 0;
    }

    await tx.empire.update({
      where: { id: empireId },
      data: {
        // Floors keep a player who demolished everything from being softlocked.
        woodCapacity: Math.max(1000, totals.wood),
        stoneCapacity: Math.max(1000, totals.stone),
        foodCapacity: Math.max(1000, totals.food),
        ironCapacity: Math.max(500, totals.iron),
        goldCapacity: Math.max(250, totals.gold),
        populationCap: Math.max(20, totals.population),
        builders: Math.max(1, totals.builders),
      },
    });
  }
}
