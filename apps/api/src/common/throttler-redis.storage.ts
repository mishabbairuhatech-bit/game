import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from '../redis/redis.service';

/**
 * Redis-backed throttler storage.
 *
 * The in-memory default gives each API replica its own counter, so scaling to
 * N replicas silently multiplies every rate limit by N. Keeping the counters
 * in Redis means the budget is per-client, not per-process - which is the
 * whole point of the limit.
 *
 * Implemented with a single Lua script so INCR, the TTL set and the block
 * bookkeeping happen atomically.
 */
const SCRIPT = `
local hitsKey  = KEYS[1]
local blockKey = KEYS[2]
local ttlMs      = tonumber(ARGV[1])
local limit      = tonumber(ARGV[2])
local blockMs    = tonumber(ARGV[3])

-- Already blocked: report the remaining block time without counting the hit.
local blockedFor = redis.call('PTTL', blockKey)
if blockedFor > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or limit)
  return { hits, blockedFor, 1 }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttlMs)
end

local timeToExpire = redis.call('PTTL', hitsKey)
if timeToExpire < 0 then
  redis.call('PEXPIRE', hitsKey, ttlMs)
  timeToExpire = ttlMs
end

if hits > limit then
  redis.call('SET', blockKey, 1, 'PX', blockMs)
  return { hits, blockMs, 1 }
end

return { hits, timeToExpire, 0 }
`;

export class ThrottlerStorageRedisService implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = this.redis.key('throttle', throttlerName, key);
    const blockKey = this.redis.key('throttle', throttlerName, key, 'blocked');

    const result = (await this.redis.client.eval(
      SCRIPT,
      2,
      hitsKey,
      blockKey,
      String(ttl),
      String(limit),
      String(blockDuration || ttl),
    )) as [number, number, number];

    const [totalHits, timeToExpire, isBlocked] = result;

    return {
      totalHits,
      timeToExpire: Math.ceil(timeToExpire / 1000),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: isBlocked === 1 ? Math.ceil(timeToExpire / 1000) : 0,
    };
  }
}
