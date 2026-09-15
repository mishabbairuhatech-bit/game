import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';

/**
 * Prisma client with:
 *   * connection retry on boot (postgres may still be starting)
 *   * slow-query logging
 *   * a `serializable()` helper for the money paths
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: AppConfigService) {
    super({
      datasources: { db: { url: config.database.url } },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
      errorFormat: config.isProduction ? 'minimal' : 'pretty',
    });
  }

  async onModuleInit(): Promise<void> {
    // Surface anything slow enough to be a missing index.
    (this as unknown as { $on: (e: string, cb: (p: Prisma.QueryEvent) => void) => void }).$on(
      'query',
      (event: Prisma.QueryEvent) => {
        if (event.duration >= 300) {
          this.logger.warn(`slow query ${event.duration}ms: ${event.query.slice(0, 300)}`);
        }
      },
    );

    await this.connectWithRetry();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Postgres' healthcheck can pass a moment before it accepts our connection,
   * and a transient blip should not kill the container.
   */
  private async connectWithRetry(attempts = 10, delayMs = 2000): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.$connect();
        this.logger.log('connected to postgres');
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === attempts) {
          this.logger.error(`could not reach postgres after ${attempts} attempts: ${message}`);
          throw error;
        }
        this.logger.warn(`postgres not ready (attempt ${attempt}/${attempts}): ${message}`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  /** Cheap liveness probe used by /ready. */
  async ping(): Promise<number> {
    const started = Date.now();
    await this.$queryRaw`SELECT 1`;
    return Date.now() - started;
  }

  /**
   * SERIALIZABLE transaction for anything that moves currency or ownership.
   * Postgres will abort one of two conflicting transactions rather than let a
   * double-spend through; the caller is expected to surface a retryable 409.
   */
  serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, timeoutMs = 10_000): Promise<T> {
    return this.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: timeoutMs,
      maxWait: 5_000,
    });
  }

  /** True when the error is a serialization failure worth retrying. */
  static isRetryable(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === 'P2034';
    }
    const code = (error as { code?: string } | null)?.code;
    // 40001 serialization_failure, 40P01 deadlock_detected
    return code === '40001' || code === '40P01';
  }

  /** Runs `fn` in a serializable transaction, retrying write conflicts. */
  async transactWithRetry<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    retries = 3,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.serializable(fn);
      } catch (error) {
        lastError = error;
        if (!PrismaService.isRetryable(error) || attempt === retries) throw error;
        // Exponential backoff with a little jitter to break up lockstep retries.
        const backoff = 25 * 2 ** attempt + Math.floor(Math.random() * 25);
        this.logger.debug(`serialization conflict, retry ${attempt + 1}/${retries} in ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastError;
  }

  /** Truncates every table. Test-suite only - refuses to run in production. */
  async resetForTests(): Promise<void> {
    if (this.config.isProduction) {
      throw new Error('resetForTests() must never run against a production database.');
    }
    const tables = await this.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
    `;
    if (tables.length === 0) return;
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await this.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
  }
}
