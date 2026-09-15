import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Typed view over process.env. Everything the app reads goes through here so
 * there is exactly one place that knows an env var's name, type and default.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be an integer, got "${raw}".`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    return String(pkg.version ?? '0.0.0');
  } catch {
    return process.env.APP_VERSION ?? '0.0.0';
  }
}

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  version: string;
  apiPrefix: string;
  swaggerEnabled: boolean;

  database: { url: string };
  redis: { url: string; keyPrefix: string };

  auth: {
    jwtSecret: string;
    jwtRefreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    bcryptRounds: number;
    maxFailedLogins: number;
    lockoutMinutes: number;
    emailVerificationTtlHours: number;
    passwordResetTtlMinutes: number;
    requireVerifiedEmail: boolean;
  };

  google: { enabled: boolean; clientId: string; clientSecret: string; callbackUrl: string };

  cors: { origins: string[] };
  urls: { web: string; admin: string; api: string };

  mail: {
    driver: 'log' | 'smtp';
    from: string;
    smtp: { host: string; port: number; user: string; password: string; secure: boolean };
  };

  payments: {
    provider: 'razorpay' | 'stripe' | 'none';
    currency: string;
    key: string;
    secret: string;
    webhookSecret: string;
  };

  rateLimit: { ttlSeconds: number; max: number; authMax: number };

  seed: { adminEmail: string; adminUsername: string; adminPassword: string };

  logging: { level: string; pretty: boolean };

  cookies: { domain: string | undefined; secure: boolean; sameSite: 'lax' | 'strict' | 'none' };
}

export function loadConfiguration(): AppConfig {
  const env = str('NODE_ENV', 'development') as AppConfig['env'];
  const isProduction = env === 'production';

  const jwtSecret = required('JWT_SECRET');
  const jwtRefreshSecret = str('JWT_REFRESH_SECRET', '') || `${jwtSecret}:refresh`;

  // A short secret in production is a real vulnerability, not a warning.
  if (isProduction && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production.');
  }
  if (isProduction && jwtSecret.startsWith('change_me')) {
    throw new Error('JWT_SECRET is still the placeholder from .env.example. Generate a real secret.');
  }

  const googleClientId = str('GOOGLE_CLIENT_ID', '');
  const googleClientSecret = str('GOOGLE_CLIENT_SECRET', '');

  return {
    env,
    isProduction,
    port: int('PORT', 4000),
    version: readVersion(),
    apiPrefix: str('API_PREFIX', 'api'),
    swaggerEnabled: bool('SWAGGER_ENABLED', !isProduction),

    database: { url: required('DATABASE_URL') },
    redis: { url: required('REDIS_URL'), keyPrefix: str('REDIS_KEY_PREFIX', 'ef:') },

    auth: {
      jwtSecret,
      jwtRefreshSecret,
      accessTtlSeconds: int('JWT_ACCESS_TTL', 900),
      refreshTtlSeconds: int('JWT_REFRESH_TTL', 2_592_000),
      bcryptRounds: int('BCRYPT_ROUNDS', 12),
      maxFailedLogins: int('AUTH_MAX_FAILED_LOGINS', 8),
      lockoutMinutes: int('AUTH_LOCKOUT_MINUTES', 15),
      emailVerificationTtlHours: int('AUTH_EMAIL_VERIFICATION_TTL_HOURS', 48),
      passwordResetTtlMinutes: int('AUTH_PASSWORD_RESET_TTL_MINUTES', 30),
      // Dev keeps this off so you can play immediately after registering.
      requireVerifiedEmail: bool('AUTH_REQUIRE_VERIFIED_EMAIL', isProduction),
    },

    google: {
      enabled: googleClientId !== '' && googleClientSecret !== '',
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      callbackUrl: str('GOOGLE_CALLBACK_URL', 'http://localhost/api/v1/auth/google/callback'),
    },

    cors: { origins: list('CORS_ORIGIN', ['http://localhost']) },
    urls: {
      web: str('WEB_URL', 'http://localhost'),
      admin: str('ADMIN_URL', 'http://localhost/admin'),
      api: str('API_URL', 'http://localhost/api'),
    },

    mail: {
      driver: str('MAIL_DRIVER', 'log') as 'log' | 'smtp',
      from: str('MAIL_FROM', 'Empire Frontier <no-reply@empire-frontier.local>'),
      smtp: {
        host: str('SMTP_HOST', ''),
        port: int('SMTP_PORT', 587),
        user: str('SMTP_USER', ''),
        password: str('SMTP_PASSWORD', ''),
        secure: bool('SMTP_SECURE', false),
      },
    },

    payments: {
      provider: str('PAYMENT_PROVIDER', 'none') as 'razorpay' | 'stripe' | 'none',
      currency: str('PAYMENT_CURRENCY', 'INR'),
      key: str('PAYMENT_KEY', ''),
      secret: str('PAYMENT_SECRET', ''),
      webhookSecret: str('PAYMENT_WEBHOOK_SECRET', ''),
    },

    rateLimit: {
      ttlSeconds: int('RATE_LIMIT_TTL', 60),
      max: int('RATE_LIMIT_MAX', 180),
      authMax: int('AUTH_RATE_LIMIT_MAX', 10),
    },

    seed: {
      adminEmail: str('SEED_ADMIN_EMAIL', 'admin@empire-frontier.local'),
      adminUsername: str('SEED_ADMIN_USERNAME', 'overseer'),
      adminPassword: str('SEED_ADMIN_PASSWORD', ''),
    },

    logging: {
      level: str('LOG_LEVEL', isProduction ? 'info' : 'debug'),
      pretty: bool('LOG_PRETTY', !isProduction),
    },

    cookies: {
      domain: str('COOKIE_DOMAIN', '') || undefined,
      secure: bool('COOKIE_SECURE', isProduction),
      sameSite: str('COOKIE_SAMESITE', 'lax') as 'lax' | 'strict' | 'none',
    },
  };
}

export type ConfigKey = keyof AppConfig;
