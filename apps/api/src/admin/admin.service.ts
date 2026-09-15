import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@empire/shared';
import { GAME_CONFIG_DEFAULT_MAP } from '@empire/game-data';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { GameConfigService } from '../game-config/game-config.service';
import { AppConfigService } from '../config/app-config.service';
import { AppException } from '../common/errors/app.exception';

export interface AdminOverview {
  users: { total: number; active: number; pendingVerification: number; banned: number; newToday: number };
  empires: { total: number; totalPower: number };
  world: { worlds: number; regions: number; zones: number; plots: number; ownedPlots: number; freePlots: number };
  catalogue: { buildings: number; buildingLevels: number; units: number; quests: number; achievements: number };
  economy: { coinsInCirculation: string; gemsInCirculation: string; ledgerEntries: number };
  marketplace: { activeListings: number; settledTransactions: number };
  moderation: { openReports: number; unreviewedSuspicions: number };
  battles: { total: number; inProgress: number };
  generatedAt: string;
}

export interface ConfigEntry {
  key: string;
  value: string;
  valueType: string;
  description: string;
  group: string;
  /** Compiled default from @empire/game-data, for a "reset" affordance. */
  defaultValue: string | null;
  overridden: boolean;
  updatedAt: string | null;
}

export interface SystemStatus {
  api: { version: string; env: string; uptimeSeconds: number };
  database: { reachable: boolean; latencyMs: number | null; migrations: number; sizeBytes: string | null };
  redis: { reachable: boolean; latencyMs: number | null; usedMemory: string | null; keys: number | null };
  features: { googleOAuth: boolean; paymentProvider: string; swagger: boolean; requireVerifiedEmail: boolean };
}

@Injectable()
export class AdminService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly gameConfig: GameConfigService,
    private readonly appConfig: AppConfigService,
  ) {}

  /* ---- overview --------------------------------------------------------- */

  /**
   * Dashboard counters.
   *
   * Cached for 15 seconds: this is a dozen aggregate queries and an operator
   * refreshing the page should not be able to load the database.
   */
  async overview(): Promise<AdminOverview> {
    return this.redis.remember('admin:overview', 15, async () => {
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);

      const [
        usersTotal,
        usersActive,
        usersPending,
        usersBanned,
        usersNewToday,
        empireCount,
        powerAggregate,
        worlds,
        regions,
        zones,
        plots,
        ownedPlots,
        freePlots,
        buildings,
        buildingLevels,
        units,
        quests,
        achievements,
        walletTotals,
        ledgerEntries,
        activeListings,
        settledTransactions,
        openReports,
        unreviewedSuspicions,
        battlesTotal,
        battlesActive,
      ] = await this.prisma.$transaction([
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.user.count({ where: { status: 'ACTIVE', deletedAt: null } }),
        this.prisma.user.count({ where: { status: 'PENDING_VERIFICATION', deletedAt: null } }),
        this.prisma.user.count({ where: { status: 'BANNED' } }),
        this.prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
        this.prisma.empire.count(),
        this.prisma.empire.aggregate({ _sum: { empirePower: true } }),
        this.prisma.world.count(),
        this.prisma.region.count(),
        this.prisma.zone.count(),
        this.prisma.plot.count(),
        this.prisma.plot.count({ where: { ownerId: { not: null } } }),
        this.prisma.plot.count({ where: { status: 'FREE' } }),
        this.prisma.buildingDefinition.count(),
        this.prisma.buildingLevel.count(),
        this.prisma.unitDefinition.count(),
        this.prisma.quest.count(),
        this.prisma.achievement.count(),
        this.prisma.wallet.aggregate({ _sum: { coins: true, gems: true } }),
        this.prisma.currencyTransaction.count(),
        this.prisma.marketplaceListing.count({ where: { status: 'ACTIVE' } }),
        this.prisma.marketplaceTransaction.count(),
        this.prisma.report.count({ where: { resolvedAt: null } }),
        this.prisma.suspiciousActivity.count({ where: { reviewedAt: null } }),
        this.prisma.battle.count(),
        this.prisma.battle.count({ where: { status: { in: ['MATCHING', 'PREPARING', 'ACTIVE'] } } }),
      ]);

      return {
        users: {
          total: usersTotal,
          active: usersActive,
          pendingVerification: usersPending,
          banned: usersBanned,
          newToday: usersNewToday,
        },
        empires: { total: empireCount, totalPower: powerAggregate._sum.empirePower ?? 0 },
        world: {
          worlds,
          regions,
          zones,
          plots,
          ownedPlots,
          freePlots,
        },
        catalogue: { buildings, buildingLevels, units, quests, achievements },
        economy: {
          coinsInCirculation: (walletTotals._sum.coins ?? 0n).toString(),
          gemsInCirculation: (walletTotals._sum.gems ?? 0n).toString(),
          ledgerEntries,
        },
        marketplace: { activeListings, settledTransactions },
        moderation: { openReports, unreviewedSuspicions },
        battles: { total: battlesTotal, inProgress: battlesActive },
        generatedAt: new Date().toISOString(),
      };
    });
  }

  /* ---- game configuration ------------------------------------------------ */

  async listConfig(): Promise<ConfigEntry[]> {
    const rows = await this.prisma.gameConfig.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });

    return rows.map((row) => {
      const compiled = GAME_CONFIG_DEFAULT_MAP.get(row.key);
      const defaultValue = compiled === undefined ? null : String(compiled);
      return {
        key: row.key,
        value: row.value,
        valueType: row.valueType,
        description: row.description,
        group: row.group,
        defaultValue,
        overridden: defaultValue !== null && defaultValue !== row.value,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  /**
   * Updates one tuning value.
   *
   * The new value is type-checked against the key's declared type before it is
   * written, because a malformed number here would surface later as a NaN cost
   * in the middle of a purchase.
   */
  async updateConfig(
    key: string,
    value: string,
    actor: { id: string; ip?: string | null; userAgent?: string | null; requestId?: string | null },
  ): Promise<ConfigEntry> {
    const existing = await this.prisma.gameConfig.findUnique({ where: { key } });
    if (!existing) {
      throw AppException.notFound(ErrorCode.NOT_FOUND, `No game config key "${key}".`);
    }

    this.assertValidValue(existing.valueType, value, key);

    await this.gameConfig.set(key, value, actor.id);

    await this.audit.admin('admin.config.update', actor.id, {
      entityType: 'GameConfig',
      entityId: key,
      before: { value: existing.value },
      after: { value },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
    });

    // Dashboard counters may reference tuning values.
    await this.redis.del('admin:overview');

    const updated = await this.prisma.gameConfig.findUniqueOrThrow({ where: { key } });
    const compiled = GAME_CONFIG_DEFAULT_MAP.get(key);
    const defaultValue = compiled === undefined ? null : String(compiled);

    return {
      key: updated.key,
      value: updated.value,
      valueType: updated.valueType,
      description: updated.description,
      group: updated.group,
      defaultValue,
      overridden: defaultValue !== null && defaultValue !== updated.value,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private assertValidValue(valueType: string, value: string, key: string): void {
    if (valueType === 'number') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw AppException.badRequest(
          ErrorCode.VALIDATION_ERROR,
          `"${key}" expects a number; received "${value}".`,
        );
      }
      if (parsed < 0) {
        throw AppException.badRequest(
          ErrorCode.VALIDATION_ERROR,
          `"${key}" cannot be negative.`,
        );
      }
      return;
    }

    if (valueType === 'boolean') {
      if (!['true', 'false'].includes(value.toLowerCase())) {
        throw AppException.badRequest(
          ErrorCode.VALIDATION_ERROR,
          `"${key}" expects true or false; received "${value}".`,
        );
      }
      return;
    }

    if (value.length > 2000) {
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, `"${key}" value is too long.`);
    }
  }

  /* ---- system ----------------------------------------------------------- */

  async system(): Promise<SystemStatus> {
    const [database, redis] = await Promise.all([this.probeDatabase(), this.probeRedis()]);

    return {
      api: {
        version: this.appConfig.version,
        env: this.appConfig.env,
        uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      },
      database,
      redis,
      features: {
        googleOAuth: this.appConfig.google.enabled,
        paymentProvider: this.appConfig.payments.provider,
        swagger: this.appConfig.swaggerEnabled,
        requireVerifiedEmail: this.appConfig.auth.requireVerifiedEmail,
      },
    };
  }

  private async probeDatabase(): Promise<SystemStatus['database']> {
    try {
      const latencyMs = await this.prisma.ping();
      const [migrations, size] = await Promise.all([
        this.prisma
          .$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "_prisma_migrations"`
          .catch(() => [{ count: 0n }]),
        this.prisma
          .$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS size`
          .catch(() => [{ size: 0n }]),
      ]);
      return {
        reachable: true,
        latencyMs,
        migrations: Number(migrations[0]?.count ?? 0n),
        sizeBytes: (size[0]?.size ?? 0n).toString(),
      };
    } catch {
      return { reachable: false, latencyMs: null, migrations: 0, sizeBytes: null };
    }
  }

  private async probeRedis(): Promise<SystemStatus['redis']> {
    try {
      const latencyMs = await this.redis.ping();
      const info = await this.redis.client.info('memory');
      const used = /used_memory:(\d+)/.exec(info)?.[1] ?? null;
      const size = await this.redis.client.dbsize();
      return { reachable: true, latencyMs, usedMemory: used, keys: size };
    } catch {
      return { reachable: false, latencyMs: null, usedMemory: null, keys: null };
    }
  }
}
