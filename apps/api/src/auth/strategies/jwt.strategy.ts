import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '@prisma/client';
import { ErrorCode, AccessTokenPayload, UserRole } from '@empire/shared';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors/app.exception';
import { RequestUser } from '../../common/decorators';

/**
 * Validates the access token *and* re-checks the account against the database
 * on every request.
 *
 * A stateless JWT alone would let a banned player keep playing for up to the
 * token's remaining lifetime. One indexed primary-key lookup per request is a
 * cheap price for being able to ban, suspend or force-logout instantly.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.auth.jwtSecret,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<RequestUser> {
    if (payload.typ !== 'access') {
      // A refresh token presented as a bearer credential is always an attack
      // or a client bug - never accept it.
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Wrong token type.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        tokenVersion: true,
        deletedAt: true,
        banReason: true,
      },
    });

    if (!user || user.deletedAt) {
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN);
    }

    // Password change / forced logout bumps tokenVersion, invalidating every
    // access token issued before it without needing a denylist.
    if (user.tokenVersion !== payload.tv) {
      throw AppException.unauthorized(
        ErrorCode.TOKEN_EXPIRED,
        'Your session ended. Please sign in again.',
      );
    }

    if (user.status === UserStatus.BANNED || user.status === UserStatus.SUSPENDED) {
      throw AppException.forbidden(ErrorCode.ACCOUNT_BANNED, user.banReason ?? undefined);
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role as UserRole,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
    };
  }
}
