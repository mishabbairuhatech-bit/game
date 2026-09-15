import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from './common/throttler-redis.storage';

import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { LoggerModule } from './logging/logger.module';
import { AuditModule } from './audit/audit.module';
import { MailModule } from './mail/mail.module';
import { EconomyModule } from './economy/economy.module';
import { GameConfigModule } from './game-config/game-config.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { PlayersModule } from './players/players.module';
import { AdminModule } from './admin/admin.module';
import { WorldModule } from './world/world.module';
import { RealtimeModule } from './realtime/realtime.module';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

@Module({
  imports: [
    // Infrastructure - all @Global, so feature modules do not re-import them.
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    AuditModule,
    MailModule,
    EconomyModule,
    GameConfigModule,

    // Rate limiting is backed by Redis so the budget is shared across every
    // API replica rather than being per-process.
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService, RedisService],
      useFactory: (config: AppConfigService, redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: seconds(config.rateLimit.ttlSeconds),
            limit: config.rateLimit.max,
          },
        ],
        storage: new ThrottlerStorageRedisService(redis),
        // NGINX terminates the connection, so trust its forwarded address.
        getTracker: (req: Record<string, unknown>) => {
          const headers = (req.headers ?? {}) as Record<string, string | undefined>;
          const forwarded = headers['x-forwarded-for'];
          return forwarded?.split(',')[0]?.trim() ?? (req.ip as string) ?? 'unknown';
        },
      }),
    }),

    // Features
    HealthModule,
    AuthModule,
    PlayersModule,
    WorldModule,
    AdminModule,
    RealtimeModule,
  ],
  providers: [
    // Order matters: throttle -> authenticate -> authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },

    {
      provide: APP_INTERCEPTOR,
      inject: [Reflector],
      useFactory: (reflector: Reflector) => new ResponseInterceptor(reflector),
    },
    {
      provide: APP_FILTER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new AllExceptionsFilter(config.isProduction),
    },
  ],
})
export class AppModule {}
