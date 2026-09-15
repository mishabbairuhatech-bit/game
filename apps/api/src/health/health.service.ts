import { Injectable } from '@nestjs/common';
import {
  DependencyHealth,
  LivenessResponse,
  ReadinessResponse,
} from '@empire/shared';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Health logic lives here rather than in a controller because it is served on
 * two paths: `/health` (outside the API prefix, so Docker's healthcheck URL
 * never changes when the API version bumps) and `/api/health` (the documented
 * public endpoint). Both must report identically.
 */
@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  /** Liveness: "is the process alive?" Deliberately touches no dependency. */
  liveness(): LivenessResponse {
    return {
      status: 'ok',
      service: 'empire-frontier-api',
      version: this.config.version,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: "can it serve traffic?" Verifies Postgres and Redis. */
  async readiness(): Promise<ReadinessResponse> {
    const [database, redis] = await Promise.all([
      this.probe(() => this.prisma.ping()),
      this.probe(() => this.redis.ping()),
    ]);

    return {
      status: database.status === 'ok' && redis.status === 'ok' ? 'ok' : 'down',
      service: 'empire-frontier-api',
      version: this.config.version,
      timestamp: new Date().toISOString(),
      dependencies: { database, redis },
    };
  }

  private async probe(fn: () => Promise<number>): Promise<DependencyHealth> {
    try {
      const latencyMs = await Promise.race([
        fn(),
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error('probe timed out after 2000ms')), 2000),
        ),
      ]);
      return { status: 'ok', latencyMs };
    } catch (error) {
      return { status: 'down', error: error instanceof Error ? error.message : String(error) };
    }
  }
}
