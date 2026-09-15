/**
 * Rate limiting, verified with the real ThrottlerGuard in place.
 *
 * Kept in its own file because every other suite overrides the guard - a
 * limiter that silently stopped working would otherwise go unnoticed until
 * someone brute-forced an account.
 */
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/config/app-config.service';
import { RedisService } from '../src/redis/redis.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';

jest.setTimeout(120_000);

describe('rate limiting', () => {
  let app: INestApplication;
  let redis: RedisService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();

    const config = app.get(AppConfigService);
    app.setGlobalPrefix(config.apiPrefix);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
    app.useGlobalFilters(new AllExceptionsFilter(false));

    await app.init();
    redis = app.get(RedisService);

    // Start from a clean counter so a previous run cannot pre-exhaust the budget.
    await redis.delPattern('throttle:*');
  });

  afterAll(async () => {
    await redis?.delPattern('throttle:*');
    await app?.close();
  });

  it('blocks repeated login attempts from one client', async () => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 14; attempt++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'throttle-probe@e2e.invalid', password: 'WrongPassword123' });
      statuses.push(res.status);
    }

    // The limiter must engage; the exact cut-over depends on configuration.
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);

    // ...and only after letting some attempts through, otherwise the limit is
    // set so low that legitimate users would be locked out.
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThan(0);

    // Once blocked, it must stay blocked within the window.
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it('counts per client rather than per process', async () => {
    // The throttler stores its counters in Redis so the budget is shared
    // across replicas. If this key is missing the storage silently fell back
    // to memory and every limit is multiplied by the replica count.
    const keys = await redis.client.keys(redis.key('throttle', '*'));
    expect(keys.length).toBeGreaterThan(0);
  });
});
