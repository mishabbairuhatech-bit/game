import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { User } from '@prisma/client';
import {
  ErrorCode,
  AccessTokenPayload,
  RefreshTokenPayload,
  UserRole,
} from '@empire/shared';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/errors/app.exception';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresAt: Date;
}

export interface SessionContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Access + refresh token lifecycle.
 *
 * Design:
 *   * Access tokens are short (15 min) and stateless. Revocation is handled by
 *     `tokenVersion` on the user - bumping it invalidates every outstanding
 *     access token without a denylist.
 *   * Refresh tokens are long-lived, stored *hashed*, and rotated on every
 *     use. Each rotation chain shares a `familyId`.
 *   * If an already-rotated refresh token is presented again, that is either
 *     a stolen token or a replay. The whole family is revoked immediately and
 *     the user must sign in again.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /* ---- issuing ---------------------------------------------------------- */

  async issue(user: User, ctx: SessionContext, familyId?: string): Promise<IssuedTokens> {
    const sessionId = randomUUID();
    const family = familyId ?? randomUUID();

    const accessToken = await this.signAccess(user);
    const rawRefresh = this.generateRefreshSecret();
    const refreshToken = await this.signRefresh(user.id, sessionId, rawRefresh);

    const refreshExpiresAt = new Date(Date.now() + this.config.auth.refreshTtlSeconds * 1000);

    await this.prisma.refreshToken.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: hash(refreshToken),
        familyId: family,
        userAgent: ctx.userAgent?.slice(0, 400) ?? null,
        ipAddress: ctx.ipAddress ?? null,
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.auth.accessTtlSeconds,
      refreshExpiresAt,
    };
  }

  private signAccess(user: User): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      role: user.role as UserRole,
      tv: user.tokenVersion,
      typ: 'access',
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.auth.jwtSecret,
      expiresIn: this.config.auth.accessTtlSeconds,
    });
  }

  private signRefresh(userId: string, sessionId: string, nonce: string): Promise<string> {
    const payload: RefreshTokenPayload & { n: string } = {
      sub: userId,
      sid: sessionId,
      typ: 'refresh',
      // Random nonce guarantees two refresh tokens issued in the same second
      // for the same session never collide on their hash.
      n: nonce,
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.auth.jwtRefreshSecret,
      expiresIn: this.config.auth.refreshTtlSeconds,
    });
  }

  private generateRefreshSecret(): string {
    return randomBytes(24).toString('base64url');
  }

  /* ---- rotation --------------------------------------------------------- */

  /**
   * Verifies a refresh token, rotates it, and returns a fresh pair.
   * Throws REFRESH_TOKEN_REUSED (and kills the family) on replay.
   */
  async rotate(rawRefreshToken: string, ctx: SessionContext): Promise<{ tokens: IssuedTokens; user: User }> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(rawRefreshToken, {
        secret: this.config.auth.jwtRefreshSecret,
      });
    } catch {
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Your session has expired. Sign in again.');
    }

    if (payload.typ !== 'refresh') {
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Wrong token type.');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash(rawRefreshToken) },
    });

    if (!stored) {
      // Signature was valid but the row is gone: either logged out, or the
      // token was rotated and this is a replay of a superseded copy.
      await this.revokeFamilyBySession(payload.sid, 'unknown refresh token presented');
      throw AppException.unauthorized(
        ErrorCode.INVALID_TOKEN,
        'That session is no longer valid. Please sign in again.',
      );
    }

    if (stored.revokedAt) {
      this.logger.warn(
        { userId: stored.userId, familyId: stored.familyId },
        'refresh token reuse detected - revoking the whole family',
      );
      await this.revokeFamily(stored.familyId);
      throw AppException.unauthorized(
        ErrorCode.REFRESH_TOKEN_REUSED,
        'This session was revoked for security reasons. Please sign in again.',
      );
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw AppException.unauthorized(ErrorCode.TOKEN_EXPIRED, 'Your session expired. Sign in again.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || user.deletedAt) {
      await this.revokeFamily(stored.familyId);
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN);
    }
    if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
      await this.revokeFamily(stored.familyId);
      throw AppException.forbidden(ErrorCode.ACCOUNT_BANNED, user.banReason ?? undefined);
    }

    const tokens = await this.issue(user, ctx, stored.familyId);

    // Mark the consumed token as replaced *after* the new one exists, so a
    // crash mid-rotation leaves the old token usable rather than locking out.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: {
        revokedAt: new Date(),
        replacedById: await this.sessionIdOf(tokens.refreshToken),
      },
    });

    return { tokens, user };
  }

  private async sessionIdOf(refreshToken: string): Promise<string | null> {
    try {
      const decoded = this.jwt.decode(refreshToken) as RefreshTokenPayload | null;
      return decoded?.sid ?? null;
    } catch {
      return null;
    }
  }

  /* ---- revocation ------------------------------------------------------- */

  /** Logout: revokes just the presented session. */
  async revokeByToken(rawRefreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeFamilyBySession(sessionId: string, reason: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({ where: { id: sessionId } });
    if (!row) return;
    this.logger.warn({ userId: row.userId, reason }, 'revoking refresh token family');
    await this.revokeFamily(row.familyId);
  }

  /** Logout everywhere. Also bump tokenVersion to kill live access tokens. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
  }

  /** Housekeeping - removes expired/revoked rows. Safe to run often. */
  async pruneExpired(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
      },
    });
    return count;
  }

  /* ---- single-use tokens (email verification, password reset) ----------- */

  /**
   * Returns the raw token to email out; only its SHA-256 is persisted, so a
   * database leak does not hand out working reset links.
   */
  generateOpaqueToken(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    return { raw, hash: hash(raw) };
  }

  static hashToken(raw: string): string {
    return hash(raw);
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
