import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

/**
 * Redis is used for three separate jobs, each of which needs its own
 * connection because a client in subscribe mode cannot issue normal commands:
 *
 *   client    - cache, rate limits, locks, leaderboards
 *   publisher - Socket.IO adapter pub side
 *   subscriber- Socket.IO adapter sub side
 *
 * Redis holds only derived or ephemeral state. Anything a player would be
 * upset to lose lives in Postgres.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  readonly client: Redis;
  readonly publisher: Redis;
  readonly subscriber: Redis;

  private readonly prefix: string;

  constructor(private readonly config: AppConfigService) {
    this.prefix = config.redis.keyPrefix;

    // A fresh options object per connection: ioredis mutates the object it is
    // handed, so sharing one instance across three clients makes their
    // connection state interfere.
    const options = (): RedisOptions => ({
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      // Give redis time to come up without crash-looping the API.
      retryStrategy: (times) => Math.min(times * 200, 5000),
      reconnectOnError: (err) => err.message.includes('READONLY'),
    });

    this.client = new Redis(config.redis.url, options());
    this.publisher = new Redis(config.redis.url, options());
    this.subscriber = new Redis(config.redis.url, options());

    for (const [name, conn] of Object.entries({
      client: this.client,
      publisher: this.publisher,
      subscriber: this.subscriber,
    })) {
      conn.on('error', (err) => this.logger.error(`redis[${name}] ${err.message}`));
    }
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.ensureConnected('client', this.client),
      this.ensureConnected('publisher', this.publisher),
      this.ensureConnected('subscriber', this.subscriber),
    ]);
    this.logger.log('connected to redis');
  }

  /**
   * Connects only from the idle state.
   *
   * `lazyConnect` leaves a client in status "wait" until something needs it,
   * but any command - including one issued by ioredis itself while resolving
   * the URL - moves it to "connecting". Calling connect() again in that state
   * throws, so check the status instead of assuming.
   */
  private async ensureConnected(name: string, conn: Redis): Promise<void> {
    // Read through a helper: TypeScript narrows `conn.status` on first check
    // and would then treat a later 'ready' comparison as unreachable, even
    // though connect() changes it at runtime.
    const statusOf = (): string => conn.status;

    if (statusOf() === 'ready') return;

    if (statusOf() === 'wait' || statusOf() === 'end') {
      await conn.connect().catch((error: Error) => {
        if (error.message.includes('already connecting')) return;
        throw error;
      });
    }

    if (statusOf() === 'ready') return;

    // Mid-handshake: wait for it to finish rather than racing it.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`redis[${name}] did not become ready within 15s`)),
        15_000,
      );
      const done = () => {
        clearTimeout(timer);
        conn.off('ready', done);
        conn.off('error', fail);
        resolve();
      };
      const fail = (error: Error) => {
        clearTimeout(timer);
        conn.off('ready', done);
        conn.off('error', fail);
        reject(error);
      };
      conn.once('ready', done);
      conn.once('error', fail);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.client.quit(),
      this.publisher.quit(),
      this.subscriber.quit(),
    ]);
  }

  /** Namespaced key so several environments can share one Redis instance. */
  key(...parts: (string | number)[]): string {
    return this.prefix + parts.join(':');
  }

  async ping(): Promise<number> {
    const started = Date.now();
    await this.client.ping();
    return Date.now() - started;
  }

  /* ---- cache helpers --------------------------------------------------- */

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.key(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A poisoned cache entry must never break a request.
      await this.client.del(this.key(key));
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(this.key(key), payload, 'EX', ttlSeconds);
    } else {
      await this.client.set(this.key(key), payload);
    }
  }

  /** Read-through cache. `factory` runs only on a miss. */
  async remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const hit = await this.getJson<T>(key);
    if (hit !== null) return hit;
    const value = await factory();
    await this.setJson(key, value, ttlSeconds);
    return value;
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.client.del(...keys.map((k) => this.key(k)));
  }

  /** Deletes every key matching a pattern using SCAN (never KEYS). */
  async delPattern(pattern: string): Promise<number> {
    let cursor = '0';
    let removed = 0;
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        this.key(pattern),
        'COUNT',
        200,
      );
      cursor = next;
      if (keys.length > 0) {
        removed += await this.client.del(...keys);
      }
    } while (cursor !== '0');
    return removed;
  }

  /* ---- counters / rate limiting ---------------------------------------- */

  /**
   * Fixed-window counter. Returns the count after incrementing, so the caller
   * can compare against its own limit.
   */
  async increment(key: string, windowSeconds: number): Promise<number> {
    const full = this.key(key);
    const results = await this.client.multi().incr(full).expire(full, windowSeconds, 'NX').exec();
    const count = results?.[0]?.[1];
    return typeof count === 'number' ? count : Number(count ?? 0);
  }

  /* ---- distributed lock ------------------------------------------------ */

  /**
   * Best-effort mutex. Used to serialise things like "settle this listing"
   * across API replicas. Correctness still comes from the database
   * transaction - this only avoids wasted contention.
   */
  async acquireLock(name: string, ttlMs = 5000): Promise<string | null> {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ok = await this.client.set(this.key('lock', name), token, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? token : null;
  }

  /** Releases only if we still hold it (compare-and-delete). */
  async releaseLock(name: string, token: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end`;
    const result = await this.client.eval(script, 1, this.key('lock', name), token);
    return result === 1;
  }

  /** Runs `fn` while holding `name`, or throws if the lock is unavailable. */
  async withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const token = await this.acquireLock(name, ttlMs);
    if (!token) throw new Error(`Could not acquire lock "${name}".`);
    try {
      return await fn();
    } finally {
      await this.releaseLock(name, token);
    }
  }
}
