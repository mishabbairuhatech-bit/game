/**
 * =============================================================================
 * PHASE 1 ACCEPTANCE SUITE
 * =============================================================================
 * Boots the real Nest application against the real PostgreSQL and Redis in
 * Docker. Nothing is mocked: these tests fail if the database is unreachable,
 * if a guard is misconfigured, or if a password is stored in a way bcrypt
 * cannot verify.
 *
 *   docker compose exec backend npm run test:e2e -w @empire/api
 *
 * Every account created here uses a run-scoped email prefix and is removed in
 * afterAll, so the suite is safe to run against a development database.
 * =============================================================================
 */
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { REFRESH_COOKIE_NAME } from '@empire/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AppConfigService } from '../src/config/app-config.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';

const RUN = `p1-${Date.now().toString(36)}`;
const email = (name: string) => `${RUN}-${name}@e2e.invalid`;

/**
 * Usernames are restricted to [a-zA-Z0-9_], so the run id cannot be reused
 * verbatim - it contains a hyphen. Truncated to the 20-character limit.
 */
const USER_PREFIX = RUN.replace(/[^a-zA-Z0-9_]/g, '_');
const username = (name: string) => `${USER_PREFIX}_${name}`.slice(0, 20);

const PASSWORD = 'Frontier2026';

jest.setTimeout(120_000);

describe('Phase 1 acceptance', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let http: () => request.Agent;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();

    // Mirror main.ts exactly - testing a differently-configured app would
    // prove nothing about the one that actually serves traffic.
    const config = app.get(AppConfigService);
    app.use(cookieParser());
    app.setGlobalPrefix(config.apiPrefix);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        validationError: { target: false, value: false },
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
    app.useGlobalFilters(new AllExceptionsFilter(false));

    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    http = () => request(app.getHttpServer());
  });

  // The suite drives far more auth requests from one address than a real user
  // ever would, so the per-IP budget is reset between tests. The guard itself
  // stays active - it is exercised deliberately in rate-limit.e2e-spec.ts.
  beforeEach(async () => {
    await redis.delPattern('throttle:*');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
    }
    await redis?.delPattern('throttle:*');
    await app?.close();
  });

  /* ====================================================================== */
  /* Health                                                                  */
  /* ====================================================================== */

  describe('health', () => {
    it('GET /api/health reports the process alive without touching a dependency', async () => {
      const res = await http().get('/api/health').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('empire-frontier-api');
      expect(typeof res.body.uptimeSeconds).toBe('number');
    });

    it('GET /api/ready verifies PostgreSQL and Redis', async () => {
      const res = await http().get('/api/ready').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.dependencies.database.status).toBe('ok');
      expect(res.body.dependencies.redis.status).toBe('ok');
    });

    it('health is version-neutral so the container probe URL never moves', async () => {
      await http().get('/api/v1/health').expect(404);
    });
  });

  /* ====================================================================== */
  /* Registration                                                            */
  /* ====================================================================== */

  describe('registration', () => {
    it('creates an account and provisions a complete, playable empire', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ email: email('signup'), username: username('signup'), password: PASSWORD })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.user.role).toBe('PLAYER');

      const userId = res.body.data.user.id;

      // The whole provisioning transaction must have committed - a half-created
      // account is worse than a failed signup.
      const [profile, empire, wallet, army, inventory] = await Promise.all([
        prisma.profile.findUnique({ where: { userId } }),
        prisma.empire.findUnique({ where: { userId } }),
        prisma.wallet.findUnique({ where: { userId } }),
        prisma.army.findFirst({ where: { empire: { userId } } }),
        prisma.inventory.findFirst({ where: { empire: { userId } } }),
      ]);

      expect(profile).not.toBeNull();
      expect(empire).not.toBeNull();
      expect(wallet).not.toBeNull();
      expect(army).not.toBeNull();
      expect(inventory).not.toBeNull();
      expect(empire!.wood).toBeGreaterThan(0);
      expect(wallet!.coins).toBeGreaterThan(0n);
    });

    it('never stores the password in plaintext, and hashes it with bcrypt', async () => {
      const address = email('hash');
      await http()
        .post('/api/v1/auth/register')
        .send({ email: address, username: username('hash'), password: PASSWORD })
        .expect(201);

      const user = await prisma.user.findUnique({ where: { email: address } });

      expect(user!.passwordHash).not.toBe(PASSWORD);
      expect(user!.passwordHash).not.toContain(PASSWORD);
      // $2b$ is the bcrypt identifier; the cost factor must be meaningful.
      expect(user!.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(Number(user!.passwordHash!.split('$')[2])).toBeGreaterThanOrEqual(10);
      await expect(bcrypt.compare(PASSWORD, user!.passwordHash!)).resolves.toBe(true);
      await expect(bcrypt.compare('', user!.passwordHash!)).resolves.toBe(false);
    });

    it('rejects a duplicate email with a machine-readable code', async () => {
      const address = email('dupe');
      await http()
        .post('/api/v1/auth/register')
        .send({ email: address, username: username('d1'), password: PASSWORD })
        .expect(201);

      const res = await http()
        .post('/api/v1/auth/register')
        .send({ email: address, username: username('d2'), password: PASSWORD })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('rejects a weak password', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ email: email('weak'), username: username('weak'), password: 'short' })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('strips an attempted privilege escalation instead of honouring it', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({
          email: email('escalate'),
          username: username('esc'),
          password: PASSWORD,
          role: 'SUPER_ADMIN',
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.error.details)).toContain('role');

      // And nothing was created.
      await expect(
        prisma.user.findUnique({ where: { email: email('escalate') } }),
      ).resolves.toBeNull();
    });
  });

  /* ====================================================================== */
  /* Login and sessions                                                      */
  /* ====================================================================== */

  describe('login and sessions', () => {
    const address = email('session');
    let accessToken: string;
    let refreshCookie: string;

    beforeAll(async () => {
      await http()
        .post('/api/v1/auth/register')
        .send({ email: address, username: username('sess'), password: PASSWORD })
        .expect(201);
    });

    it('issues an access token and an httpOnly refresh cookie', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: address, password: PASSWORD })
        .expect(200);

      accessToken = res.body.data.accessToken;
      expect(accessToken).toEqual(expect.any(String));
      expect(res.body.data.tokenType).toBe('Bearer');

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const refresh = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
      expect(refresh).toBeDefined();

      // The refresh credential must be unreachable from JavaScript, so an XSS
      // bug cannot walk off with a 30-day session.
      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('Path=/api');

      refreshCookie = refresh!.split(';')[0]!;
    });

    it('rejects a wrong password without revealing whether the account exists', async () => {
      const wrongPassword = await http()
        .post('/api/v1/auth/login')
        .send({ email: address, password: 'WrongPassword123' })
        .expect(401);

      const noSuchAccount = await http()
        .post('/api/v1/auth/login')
        .send({ email: email('ghost'), password: PASSWORD })
        .expect(401);

      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(noSuchAccount.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(noSuchAccount.body.error.message).toBe(wrongPassword.body.error.message);
    });

    it('returns the signed-in account from /auth/me', async () => {
      const res = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data.email).toBe(address);
      expect(res.body.data).not.toHaveProperty('passwordHash');
    });

    it('rotates the refresh token and detects a replay of the old one', async () => {
      const rotated = await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .send({})
        .expect(200);

      expect(rotated.body.data.accessToken).toEqual(expect.any(String));

      // Replaying the consumed token must kill the whole session family.
      const replay = await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .send({})
        .expect(401);

      expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

      const newCookies = rotated.headers['set-cookie'] as unknown as string[];
      const newCookie = newCookies
        .find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))!
        .split(';')[0]!;

      // ...including the token that replaced it.
      await http().post('/api/v1/auth/refresh').set('Cookie', newCookie).send({}).expect(401);
    });

    it('invalidates the session on logout', async () => {
      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email: address, password: PASSWORD })
        .expect(200);

      const cookie = (login.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))!
        .split(';')[0]!;

      await http().post('/api/v1/auth/logout').set('Cookie', cookie).send({}).expect(200);

      // The revoked cookie must no longer buy a new access token.
      await http().post('/api/v1/auth/refresh').set('Cookie', cookie).send({}).expect(401);
    });

    it('logout-all revokes every live access token by bumping the token version', async () => {
      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email: address, password: PASSWORD })
        .expect(200);

      const token = login.body.data.accessToken;
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);

      await http()
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // The token is still cryptographically valid but must be refused.
      const after = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(after.body.error.code).toBe('TOKEN_EXPIRED');
    });
  });

  /* ====================================================================== */
  /* Authorisation                                                           */
  /* ====================================================================== */

  describe('authorisation', () => {
    let playerToken: string;

    beforeAll(async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ email: email('authz'), username: username('authz'), password: PASSWORD })
        .expect(201);
      playerToken = res.body.data.accessToken;
    });

    it.each([
      ['/api/v1/auth/me'],
      ['/api/v1/players/me/empire'],
      ['/api/v1/players/me/profile'],
      ['/api/v1/admin/overview'],
    ])('rejects an unauthenticated request to %s', async (path) => {
      const res = await http().get(path).expect(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a malformed bearer token', async () => {
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it.each([
      ['/api/v1/admin/overview'],
      ['/api/v1/admin/system'],
      ['/api/v1/admin/config'],
    ])('refuses a PLAYER on the admin route %s', async (path) => {
      const res = await http()
        .get(path)
        .set('Authorization', `Bearer ${playerToken}`)
        .expect(403);

      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    });

    it('refuses a PLAYER writing game configuration', async () => {
      const res = await http()
        .patch('/api/v1/admin/config/market.feeBps')
        .set('Authorization', `Bearer ${playerToken}`)
        .send({ value: '0' })
        .expect(403);

      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    });
  });

  /* ====================================================================== */
  /* Player data                                                             */
  /* ====================================================================== */

  describe('player data', () => {
    let token: string;
    let handle: string;

    beforeAll(async () => {
      handle = username('data');
      const res = await http()
        .post('/api/v1/auth/register')
        .send({
          email: email('data'),
          username: handle,
          password: PASSWORD,
          empireName: 'The Iron Marches',
        })
        .expect(201);
      token = res.body.data.accessToken;
    });

    it('returns the empire with resources, capacities and a wallet', async () => {
      const res = await http()
        .get('/api/v1/players/me/empire')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const empire = res.body.data;
      expect(empire.name).toBe('The Iron Marches');
      expect(empire.hqLevel).toBeGreaterThanOrEqual(1);

      for (const key of ['WOOD', 'STONE', 'FOOD', 'IRON', 'GOLD']) {
        expect(empire.resources[key].amount).toBeGreaterThanOrEqual(0);
        expect(empire.resources[key].capacity).toBeGreaterThan(0);
        // A stockpile above its cap would mean accrual is not clamping.
        expect(empire.resources[key].amount).toBeLessThanOrEqual(empire.resources[key].capacity);
      }

      // BigInt balances must serialise as strings, never as lossy numbers.
      expect(typeof empire.wallet.coins).toBe('string');
      expect(typeof empire.wallet.gems).toBe('string');
    });

    it('returns a public profile without leaking the email', async () => {
      const res = await http()
        .get(`/api/v1/players/${handle}/profile`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.username).toBe(handle);
      expect(JSON.stringify(res.body.data)).not.toContain('@e2e.invalid');
    });

    it('404s for an unknown commander', async () => {
      const res = await http()
        .get('/api/v1/players/no-such-commander/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  /* ====================================================================== */
  /* Economy                                                                 */
  /* ====================================================================== */

  describe('currency ledger', () => {
    it('backs every starting balance with a ledger entry', async () => {
      const address = email('ledger');
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ email: address, username: username('ledg'), password: PASSWORD })
        .expect(201);

      const userId = res.body.data.user.id;

      const [wallet, entries] = await Promise.all([
        prisma.wallet.findUniqueOrThrow({ where: { userId } }),
        prisma.currencyTransaction.findMany({ where: { userId } }),
      ]);

      expect(entries.length).toBeGreaterThan(0);

      // The ledger must reconcile exactly against the wallet, per currency.
      const sum = (currency: 'COINS' | 'GEMS') =>
        entries
          .filter((e) => e.currency === currency)
          .reduce((total, e) => total + e.amount, 0n);

      expect(sum('COINS')).toBe(wallet.coins);
      expect(sum('GEMS')).toBe(wallet.gems);

      for (const entry of entries) {
        expect(entry.reason).toBe('SIGNUP_GRANT');
        expect(entry.balanceAfter).toBeGreaterThanOrEqual(0n);
      }
    });
  });

  /* ====================================================================== */
  /* Error envelope                                                          */
  /* ====================================================================== */

  describe('error envelope', () => {
    it('shapes every failure identically', async () => {
      const res = await http().get('/api/v1/players/me/empire').expect(401);

      expect(res.body).toEqual({
        success: false,
        error: {
          code: expect.any(String),
          message: expect.any(String),
          timestamp: expect.any(String),
        },
      });
    });

    it('shapes every success identically', async () => {
      const res = await http().get('/api/v1/auth/me').expect(401);
      expect(res.body.success).toBe(false);

      const health = await http().get('/api/health').expect(200);
      // Health opts out of the envelope on purpose - probes are consumed by
      // orchestrators that expect a bare body.
      expect(health.body.success).toBeUndefined();
      expect(health.body.status).toBe('ok');
    });

    it('never leaks a stack trace or internal detail', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', username: 'x', password: 'x' })
        .expect(400);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('stack');
      expect(body).not.toContain('node_modules');
      expect(body).not.toContain('prisma');
    });
  });

  /* ====================================================================== */
  /* Seeded catalogue                                                        */
  /* ====================================================================== */

  describe('seed', () => {
    it('populated the game catalogue', async () => {
      const [buildings, levels, units, resources, quests, achievements, config] =
        await Promise.all([
          prisma.buildingDefinition.count(),
          prisma.buildingLevel.count(),
          prisma.unitDefinition.count(),
          prisma.resource.count(),
          prisma.quest.count(),
          prisma.achievement.count(),
          prisma.gameConfig.count(),
        ]);

      expect(buildings).toBeGreaterThanOrEqual(20);
      expect(levels).toBeGreaterThan(100);
      expect(units).toBeGreaterThanOrEqual(7);
      expect(resources).toBe(7);
      expect(quests).toBeGreaterThan(0);
      expect(achievements).toBeGreaterThan(0);
      expect(config).toBeGreaterThan(20);
    });

    it('created exactly one bootstrap admin, with a usable password', async () => {
      const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' } });
      expect(admins.length).toBeGreaterThanOrEqual(1);

      for (const admin of admins) {
        expect(admin.passwordHash).toMatch(/^\$2[aby]\$/);
        // Regression guard: an earlier seed hashed the empty string when
        // SEED_ADMIN_PASSWORD was present-but-blank, producing an admin that
        // anyone could sign in as.
        await expect(bcrypt.compare('', admin.passwordHash!)).resolves.toBe(false);
      }
    });
  });
});
