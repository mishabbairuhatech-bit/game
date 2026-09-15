import type { UserRole, UserStatus } from './enums';

/** Payload embedded in the short-lived access JWT. */
export interface AccessTokenPayload {
  sub: string;        // user id
  role: UserRole;
  tv: number;         // token version - bumping it invalidates all access tokens
  typ: 'access';
  iat?: number;
  exp?: number;
}

/** Payload embedded in the rotating refresh JWT. */
export interface RefreshTokenPayload {
  sub: string;
  sid: string;        // session id (RefreshToken row) - enables reuse detection
  typ: 'refresh';
  iat?: number;
  exp?: number;
}

/** Shape returned by /auth/me and embedded in login/refresh responses. */
export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  avatarUrl: string | null;
  createdAt: string;
  profile?: {
    displayName: string;
    level: number;
    xp: number;
    empireName: string | null;
  } | null;
}

export interface AuthTokens {
  accessToken: string;
  /** Seconds until `accessToken` expires. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface LoginResult extends AuthTokens {
  user: AuthUser;
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

/**
 * Shared password policy so the client can pre-validate with exactly the same
 * rules the server enforces. The server is still the authority.
 */
export function validatePassword(pw: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (pw.length < PASSWORD_MIN_LENGTH) reasons.push(`At least ${PASSWORD_MIN_LENGTH} characters.`);
  if (pw.length > PASSWORD_MAX_LENGTH) reasons.push(`At most ${PASSWORD_MAX_LENGTH} characters.`);
  if (!/[a-z]/.test(pw)) reasons.push('At least one lowercase letter.');
  if (!/[A-Z]/.test(pw)) reasons.push('At least one uppercase letter.');
  if (!/[0-9]/.test(pw)) reasons.push('At least one number.');
  return { ok: reasons.length === 0, reasons };
}

export const REFRESH_COOKIE_NAME = 'ef_refresh';

/**
 * Non-httpOnly companion to the refresh cookie.
 *
 * Carries no secret and grants nothing - it exists purely so the client can
 * tell whether a session *might* exist before firing a refresh request. The
 * refresh cookie itself is httpOnly and therefore invisible to JavaScript, so
 * without this hint every cold page load would have to speculatively call
 * /auth/refresh and eat a 401.
 *
 * The server still validates the real cookie on every refresh; forging this
 * flag only buys the attacker a 401.
 */
export const SESSION_HINT_COOKIE_NAME = 'ef_session';
export const CSRF_COOKIE_NAME = 'ef_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';
