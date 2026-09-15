import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GAME_CONFIG_DEFAULT_MAP } from '@empire/game-data';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const CACHE_KEY = 'gameconfig:all';
const CACHE_TTL_SECONDS = 60;

/**
 * Runtime game tuning.
 *
 * Resolution order: database row -> compiled default from @empire/game-data.
 * The whole table is small, so it is cached as one Redis entry and refreshed
 * on write. Balance changes made in the admin panel therefore take effect
 * across every API replica within a minute, with no deploy.
 */
@Injectable()
export class GameConfigService implements OnModuleInit {
  private readonly logger = new Logger(GameConfigService.name);

  /** Process-local mirror so a hot path never waits on Redis. */
  private local: Map<string, string> = new Map();
  private localLoadedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh().catch((error) =>
      this.logger.warn(`could not preload game config, falling back to defaults: ${error}`),
    );
  }

  /* ---- reads ------------------------------------------------------------ */

  async getString(key: string, fallback?: string): Promise<string> {
    const raw = await this.raw(key);
    if (raw !== undefined) return raw;
    const compiled = GAME_CONFIG_DEFAULT_MAP.get(key);
    if (compiled !== undefined) return String(compiled);
    if (fallback !== undefined) return fallback;
    throw new Error(`Unknown game config key "${key}" and no fallback supplied.`);
  }

  async getNumber(key: string, fallback?: number): Promise<number> {
    const value = Number(await this.getString(key, fallback?.toString()));
    if (Number.isNaN(value)) {
      throw new Error(`Game config "${key}" is not a number.`);
    }
    return value;
  }

  async getInt(key: string, fallback?: number): Promise<number> {
    return Math.trunc(await this.getNumber(key, fallback));
  }

  async getBigInt(key: string, fallback?: number): Promise<bigint> {
    return BigInt(Math.trunc(await this.getNumber(key, fallback)));
  }

  async getBoolean(key: string, fallback?: boolean): Promise<boolean> {
    const raw = (await this.getString(key, fallback === undefined ? undefined : String(fallback)))
      .trim()
      .toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes';
  }

  /** Reads several keys in one pass - avoids N cache round trips. */
  async getMany(keys: string[]): Promise<Record<string, string>> {
    await this.ensureLoaded();
    const out: Record<string, string> = {};
    for (const key of keys) {
      const local = this.local.get(key);
      out[key] = local ?? String(GAME_CONFIG_DEFAULT_MAP.get(key) ?? '');
    }
    return out;
  }

  async all(): Promise<Record<string, string>> {
    await this.ensureLoaded();
    const merged: Record<string, string> = {};
    for (const [k, v] of GAME_CONFIG_DEFAULT_MAP) merged[k] = String(v);
    for (const [k, v] of this.local) merged[k] = v;
    return merged;
  }

  /* ---- writes ----------------------------------------------------------- */

  /** Called by the admin panel. Invalidates the cache immediately. */
  async set(key: string, value: string, updatedById?: string): Promise<void> {
    const existing = await this.prisma.gameConfig.findUnique({ where: { key } });
    const compiled = GAME_CONFIG_DEFAULT_MAP.get(key);

    await this.prisma.gameConfig.upsert({
      where: { key },
      update: { value, updatedById: updatedById ?? null },
      create: {
        key,
        value,
        valueType: typeof compiled === 'number' ? 'number' : typeof compiled === 'boolean' ? 'boolean' : 'string',
        description: existing?.description ?? 'Set from the admin panel.',
        group: existing?.group ?? 'general',
        updatedById: updatedById ?? null,
      },
    });

    await this.refresh();
  }

  async refresh(): Promise<void> {
    const rows = await this.prisma.gameConfig.findMany({ select: { key: true, value: true } });
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;

    this.local = new Map(Object.entries(map));
    this.localLoadedAt = Date.now();
    await this.redis.setJson(CACHE_KEY, map, CACHE_TTL_SECONDS);
  }

  /* ---- internals -------------------------------------------------------- */

  private async raw(key: string): Promise<string | undefined> {
    await this.ensureLoaded();
    return this.local.get(key);
  }

  private async ensureLoaded(): Promise<void> {
    if (Date.now() - this.localLoadedAt < CACHE_TTL_SECONDS * 1000) return;

    const cached = await this.redis.getJson<Record<string, string>>(CACHE_KEY);
    if (cached) {
      this.local = new Map(Object.entries(cached));
      this.localLoadedAt = Date.now();
      return;
    }
    await this.refresh();
  }
}
