import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  AuthProvider,
  Prisma,
  UserStatus,
  VerificationTokenType,
  User,
} from '@prisma/client';
import { ErrorCode, AuthUser, UserRole } from '@empire/shared';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { AppException } from '../common/errors/app.exception';
import { PlayerBootstrapService } from '../players/player-bootstrap.service';
import { TokenService, IssuedTokens, SessionContext } from './token.service';

export interface AuthResult {
  user: AuthUser;
  tokens: IssuedTokens;
}

/**
 * All credential handling. Rules that hold everywhere in here:
 *
 *   * Passwords are only ever compared with bcrypt; plaintext is never stored,
 *     logged or returned.
 *   * Endpoints that take an email must not reveal whether that email exists.
 *     Registration is the one exception, because a unique username/email is
 *     inherently observable - it is rate limited at the edge instead.
 *   * Every auth event writes an audit row.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly bootstrap: PlayerBootstrapService,
  ) {}

  /* ====================================================================== */
  /* Registration                                                            */
  /* ====================================================================== */

  async register(
    input: { email: string; username: string; password: string; empireName?: string },
    ctx: SessionContext,
  ): Promise<AuthResult> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
      select: { id: true, email: true, username: true },
    });
    if (existing) {
      throw existing.email.toLowerCase() === input.email.toLowerCase()
        ? AppException.conflict(ErrorCode.EMAIL_ALREADY_REGISTERED)
        : AppException.conflict(ErrorCode.USERNAME_TAKEN);
    }

    const passwordHash = await bcrypt.hash(input.password, this.config.auth.bcryptRounds);

    // One transaction creates the account *and* everything a player needs to
    // start playing: profile, wallet, empire, starter plot, buildings, army.
    // A half-created account is worse than a failed signup.
    const user = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.user.create({
          data: {
            email: input.email,
            username: input.username,
            passwordHash,
            status: this.config.auth.requireVerifiedEmail
              ? UserStatus.PENDING_VERIFICATION
              : UserStatus.ACTIVE,
            emailVerifiedAt: this.config.auth.requireVerifiedEmail ? null : new Date(),
            profile: {
              create: {
                displayName: input.username,
                empireName: input.empireName?.trim() || `${input.username}'s Dominion`,
              },
            },
            wallet: { create: {} },
          },
        });

        await this.bootstrap.provisionNewPlayer(tx, created, {
          empireName: input.empireName?.trim() || `${input.username}'s Dominion`,
        });

        return created;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );

    await this.audit.user('auth.register', user.id, {
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, username: user.username },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.issueVerificationEmail(user).catch((error) =>
      this.logger.error({ err: error }, 'failed to send verification email'),
    );

    const tokens = await this.tokens.issue(user, ctx);
    return { user: await this.toAuthUser(user), tokens };
  }

  /* ====================================================================== */
  /* Login                                                                   */
  /* ====================================================================== */

  async login(email: string, password: string, ctx: SessionContext): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always spend roughly the same time whether or not the account exists,
    // so response timing does not enumerate registered emails.
    if (!user || !user.passwordHash) {
      await bcrypt.compare(password, await timingEqualiser(this.config.auth.bcryptRounds));
      throw AppException.unauthorized(ErrorCode.INVALID_CREDENTIALS);
    }

    if (user.deletedAt) {
      throw AppException.unauthorized(ErrorCode.INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw AppException.forbidden(
        ErrorCode.ACCOUNT_LOCKED,
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await this.registerFailedLogin(user, ctx);
      throw AppException.unauthorized(ErrorCode.INVALID_CREDENTIALS);
    }

    this.assertLoginAllowed(user);

    const refreshed = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ctx.ipAddress ?? null,
      },
    });

    await this.audit.user('auth.login', user.id, {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const tokens = await this.tokens.issue(refreshed, ctx);
    return { user: await this.toAuthUser(refreshed), tokens };
  }

  private assertLoginAllowed(user: User): void {
    if (user.status === UserStatus.BANNED) {
      throw AppException.forbidden(
        ErrorCode.ACCOUNT_BANNED,
        user.banReason ? `This account is banned: ${user.banReason}` : undefined,
      );
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw AppException.forbidden(ErrorCode.ACCOUNT_BANNED, 'This account is suspended.');
    }
    if (user.status === UserStatus.DELETED) {
      throw AppException.unauthorized(ErrorCode.INVALID_CREDENTIALS);
    }
    if (
      this.config.auth.requireVerifiedEmail &&
      user.status === UserStatus.PENDING_VERIFICATION
    ) {
      throw AppException.forbidden(ErrorCode.EMAIL_NOT_VERIFIED);
    }
  }

  private async registerFailedLogin(user: User, ctx: SessionContext): Promise<void> {
    const attempts = user.failedLoginCount + 1;
    const shouldLock = attempts >= this.config.auth.maxFailedLogins;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + this.config.auth.lockoutMinutes * 60_000)
          : user.lockedUntil,
      },
    });

    await this.audit.user('auth.login_failed', user.id, {
      after: { attempts, locked: shouldLock },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /* ====================================================================== */
  /* Session lifecycle                                                       */
  /* ====================================================================== */

  async refresh(rawRefreshToken: string, ctx: SessionContext): Promise<AuthResult> {
    const { tokens, user } = await this.tokens.rotate(rawRefreshToken, ctx);
    return { user: await this.toAuthUser(user), tokens };
  }

  async logout(rawRefreshToken: string | undefined, userId?: string): Promise<void> {
    if (rawRefreshToken) await this.tokens.revokeByToken(rawRefreshToken);
    if (userId) await this.audit.user('auth.logout', userId);
  }

  async logoutEverywhere(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
    await this.audit.user('auth.logout_all', userId);
  }

  /* ====================================================================== */
  /* Email verification                                                      */
  /* ====================================================================== */

  private async issueVerificationEmail(user: User): Promise<void> {
    const { raw, hash } = this.tokens.generateOpaqueToken();

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: VerificationTokenType.EMAIL_VERIFICATION,
        tokenHash: hash,
        expiresAt: new Date(
          Date.now() + this.config.auth.emailVerificationTtlHours * 3_600_000,
        ),
      },
    });

    await this.mail.sendVerificationEmail(user.email, user.username, raw);
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Silently succeed for unknown / already-verified addresses so this
    // endpoint cannot be used to probe which emails are registered.
    if (!user || user.emailVerifiedAt || user.deletedAt) return;

    // Invalidate outstanding tokens so only the newest link works.
    await this.prisma.verificationToken.updateMany({
      where: {
        userId: user.id,
        type: VerificationTokenType.EMAIL_VERIFICATION,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });

    await this.issueVerificationEmail(user);
  }

  async verifyEmail(rawToken: string): Promise<AuthUser> {
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: TokenService.hashToken(rawToken) },
      include: { user: true },
    });

    if (
      !record ||
      record.type !== VerificationTokenType.EMAIL_VERIFICATION ||
      record.consumedAt ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw AppException.badRequest(
        ErrorCode.INVALID_TOKEN,
        'This verification link is invalid or has expired. Request a new one.',
      );
    }

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.verificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return tx.user.update({
        where: { id: record.userId },
        data: {
          emailVerifiedAt: new Date(),
          status:
            record.user.status === UserStatus.PENDING_VERIFICATION
              ? UserStatus.ACTIVE
              : record.user.status,
        },
      });
    });

    await this.audit.user('auth.email_verified', user.id);
    return this.toAuthUser(user);
  }

  /* ====================================================================== */
  /* Password reset                                                          */
  /* ====================================================================== */

  async forgotPassword(email: string, ctx: SessionContext): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Same response either way - never confirm whether an account exists.
    if (!user || user.deletedAt || user.status === UserStatus.BANNED) return;

    await this.prisma.verificationToken.updateMany({
      where: { userId: user.id, type: VerificationTokenType.PASSWORD_RESET, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const { raw, hash } = this.tokens.generateOpaqueToken();
    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: VerificationTokenType.PASSWORD_RESET,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + this.config.auth.passwordResetTtlMinutes * 60_000),
      },
    });

    await this.mail.sendPasswordResetEmail(user.email, user.username, raw);
    await this.audit.user('auth.password_reset_requested', user.id, {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async resetPassword(rawToken: string, newPassword: string, ctx: SessionContext): Promise<void> {
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: TokenService.hashToken(rawToken) },
    });

    if (
      !record ||
      record.type !== VerificationTokenType.PASSWORD_RESET ||
      record.consumedAt ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw AppException.badRequest(
        ErrorCode.INVALID_TOKEN,
        'This reset link is invalid or has expired. Request a new one.',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, this.config.auth.bcryptRounds);

    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          // Invalidates every live access token for this account.
          tokenVersion: { increment: 1 },
        },
      }),
      // A password reset must end every other session.
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.user('auth.password_reset', record.userId, {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ctx: SessionContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound();

    if (!user.passwordHash) {
      throw AppException.badRequest(
        ErrorCode.BAD_REQUEST,
        'This account signs in with Google. Set a password from your provider instead.',
      );
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw AppException.unauthorized(ErrorCode.INVALID_CREDENTIALS, 'Current password is incorrect.');

    const passwordHash = await bcrypt.hash(newPassword, this.config.auth.bcryptRounds);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.user('auth.password_changed', userId, {
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /* ====================================================================== */
  /* OAuth                                                                   */
  /* ====================================================================== */

  /**
   * Find-or-create for a verified OAuth identity.
   *
   * The provider has already proven the email, so the account is active
   * immediately. If a local account exists for the same address we link the
   * provider to it rather than creating a duplicate empire.
   */
  async findOrCreateOAuthUser(
    provider: AuthProvider,
    profile: {
      providerUserId: string;
      email: string;
      displayName?: string;
      avatarUrl?: string;
    },
    ctx: SessionContext,
  ): Promise<AuthResult> {
    const email = profile.email.toLowerCase();

    const linked = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: { provider, providerUserId: profile.providerUserId },
      },
      include: { user: true },
    });

    if (linked) {
      this.assertLoginAllowed(linked.user);
      const updated = await this.prisma.user.update({
        where: { id: linked.userId },
        data: { lastLoginAt: new Date(), lastLoginIp: ctx.ipAddress ?? null },
      });
      await this.audit.user('auth.oauth_login', updated.id, { after: { provider } });
      const tokens = await this.tokens.issue(updated, ctx);
      return { user: await this.toAuthUser(updated), tokens };
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.deletedAt) throw AppException.unauthorized(ErrorCode.INVALID_CREDENTIALS);
      this.assertLoginAllowed(existing);

      await this.prisma.oAuthAccount.create({
        data: {
          userId: existing.id,
          provider,
          providerUserId: profile.providerUserId,
          email,
          displayName: profile.displayName ?? null,
          avatarUrl: profile.avatarUrl ?? null,
        },
      });

      // The provider verified the address, so trust it.
      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          status:
            existing.status === UserStatus.PENDING_VERIFICATION
              ? UserStatus.ACTIVE
              : existing.status,
          lastLoginAt: new Date(),
          lastLoginIp: ctx.ipAddress ?? null,
        },
      });

      await this.audit.user('auth.oauth_linked', updated.id, { after: { provider } });
      const tokens = await this.tokens.issue(updated, ctx);
      return { user: await this.toAuthUser(updated), tokens };
    }

    const localPart = email.split('@')[0] ?? 'commander';
    const username = await this.deriveUniqueUsername(profile.displayName ?? localPart);

    const user = await this.prisma.$transaction(
      async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            username,
            passwordHash: null,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date(),
            avatarUrl: profile.avatarUrl ?? null,
            profile: {
              create: {
                displayName: profile.displayName?.slice(0, 40) ?? username,
                empireName: `${username}'s Dominion`,
              },
            },
            wallet: { create: {} },
            oauthAccounts: {
              create: {
                provider,
                providerUserId: profile.providerUserId,
                email,
                displayName: profile.displayName ?? null,
                avatarUrl: profile.avatarUrl ?? null,
              },
            },
          },
        });

        await this.bootstrap.provisionNewPlayer(tx, created, {
          empireName: `${username}'s Dominion`,
        });
        return created;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );

    await this.audit.user('auth.oauth_register', user.id, { after: { provider } });
    const tokens = await this.tokens.issue(user, ctx);
    return { user: await this.toAuthUser(user), tokens };
  }

  /** "Jane Doe" -> "JaneDoe", then "JaneDoe1", "JaneDoe2", ... until free. */
  private async deriveUniqueUsername(seed: string): Promise<string> {
    const base =
      seed
        .replace(/[^a-zA-Z0-9_]/g, '')
        .slice(0, 16)
        .padEnd(3, '0') || 'commander';

    for (let suffix = 0; suffix < 200; suffix++) {
      const candidate = suffix === 0 ? base : `${base}${suffix}`;
      const taken = await this.prisma.user.findUnique({
        where: { username: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    // Astronomically unlikely; a random tail is still better than failing.
    return `${base}${Date.now().toString(36).slice(-5)}`;
  }

  /* ====================================================================== */
  /* Shared                                                                  */
  /* ====================================================================== */

  /** Loads a user by id and shapes it for the client. Used by GET /auth/me. */
  async getAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw AppException.notFound();
    return this.toAuthUser(user);
  }

  async toAuthUser(user: User): Promise<AuthUser> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      select: { displayName: true, level: true, xp: true, empireName: true },
    });

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role as UserRole,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt.toISOString(),
      profile: profile ?? null,
    };
  }
}

/**
 * A bcrypt hash of a value nobody knows, generated once at boot.
 *
 * Comparing against it on the "no such user" path makes a failed login cost
 * the same as a successful one, so response timing cannot be used to
 * enumerate which email addresses are registered.
 *
 * Generated rather than hard-coded: a literal hash in source invites someone
 * to mistake it for a credential, and pins the cost factor to whatever was
 * current when it was written instead of the configured one.
 */
// The *promise* is memoised, not the resolved value: caching the value would
// let two concurrent first-logins both run bcrypt and race to assign.
let dummyHashPromise: Promise<string> | null = null;

function timingEqualiser(rounds: number): Promise<string> {
  dummyHashPromise ??= bcrypt.hash(randomBytes(32).toString('base64'), rounds);
  return dummyHashPromise;
}

/** Constant-time string compare for opaque tokens compared outside bcrypt. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type { Prisma };
