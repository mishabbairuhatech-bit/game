import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { RedisService } from './redis/redis.service';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

/**
 * Prisma returns BigInt for money columns, and JSON.stringify throws on
 * BigInt. Serialising as a decimal *string* rather than a Number is
 * deliberate: a balance above 2^53 would silently lose precision as a JS
 * number, and a wrong coin balance is not an acceptable rounding error.
 */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // NGINX owns CORS-free routing; the API is never exposed directly.
    cors: false,
  });

  app.useLogger(app.get(PinoLogger));
  const config = app.get(AppConfigService);
  const logger = app.get(PinoLogger);

  /* ---- trust the reverse proxy ----------------------------------------- */
  // Without this, req.ip is the NGINX container address and every rate limit
  // would apply to the proxy rather than the client.
  app.set('trust proxy', 1);

  /* ---- security headers ------------------------------------------------- */
  app.use(
    helmet({
      // The SPA is served by NGINX, which sets the page CSP. Helmet's default
      // CSP here would only apply to JSON responses and confuse Swagger UI.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use(cookieParser());

  /* ---- CORS -------------------------------------------------------------- */
  app.enableCors({
    origin: (origin, callback) => {
      // Same-origin (no Origin header) and server-to-server calls are fine.
      if (!origin) return callback(null, true);
      if (config.cors.origins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  /* ---- routing ----------------------------------------------------------- */
  // Everything sits under /api. The health routes are VERSION_NEUTRAL so they
  // resolve to /api/health and /api/ready rather than /api/v1/health - the
  // container healthcheck URL must not move when the API version bumps.
  // NGINX aliases the bare /health and /ready onto these for ops tooling.
  app.setGlobalPrefix(config.apiPrefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  /* ---- validation -------------------------------------------------------- */
  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown properties instead of trusting them: a client cannot
      // smuggle `role: 'ADMIN'` into a registration body.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
      stopAtFirstError: false,
    }),
  );

  /* ---- realtime ----------------------------------------------------------- */
  const redisAdapter = new RedisIoAdapter(app, app.get(RedisService), config.cors.origins);
  redisAdapter.connect();
  app.useWebSocketAdapter(redisAdapter);

  /* ---- OpenAPI ------------------------------------------------------------ */
  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Empire Frontier API')
        .setDescription(
          'Server-authoritative API for the Empire Frontier strategy game.\n\n' +
            '**Response envelope** - every success is `{ success: true, data }` and every ' +
            'failure is `{ success: false, error: { code, message } }`. Branch on `error.code`, ' +
            'never on `error.message`.\n\n' +
            '**Auth** - `POST /auth/login` returns a short-lived bearer access token and sets ' +
            'an httpOnly refresh cookie. Send the access token as `Authorization: Bearer <token>`.\n\n' +
            '**Note on virtual property** - plots, resources and currencies in this API are ' +
            'in-game virtual items with no real-world value or ownership.',
        )
        .setVersion(config.version)
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
          'access-token',
        )
        .addCookieAuth('ef_refresh', { type: 'apiKey', in: 'cookie' }, 'refresh-cookie')
        .addServer(config.urls.api, 'Through NGINX')
        .addTag('health', 'Liveness and readiness probes')
        .addTag('auth', 'Registration, sessions, password and OAuth')
        .addTag('players', 'Profiles and empire state')
        .addTag('world', 'World, regions, zones, plots and map queries')
        .addTag('territory', 'Player land holdings and expansion')
        .addTag('admin', 'Operations panel - MODERATOR and above')
        .build(),
      { operationIdFactory: (_controller, method) => method },
    );

    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs-json',
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
      customSiteTitle: 'Empire Frontier API',
    });
  }

  /* ---- lifecycle ---------------------------------------------------------- */
  // Lets Nest run onModuleDestroy hooks (closing Prisma/Redis) when Docker
  // sends SIGTERM, instead of the process being killed mid-transaction.
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');

  logger.log(
    `Empire Frontier API v${config.version} listening on :${config.port} ` +
      `[${config.env}] prefix=/${config.apiPrefix}/v1 ` +
      `swagger=${config.swaggerEnabled ? 'on' : 'off'} ` +
      `google-oauth=${config.google.enabled ? 'on' : 'off'} ` +
      `payments=${config.payments.provider}`,
  );
}

bootstrap().catch((error) => {
  // The logger may not exist yet if config validation threw.
   
  console.error('Fatal: API failed to start.', error);
  process.exit(1);
});
