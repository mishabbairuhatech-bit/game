import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import { ErrorCode } from '@empire/shared';
import { AppConfigService } from '../../config/app-config.service';
import { AppException } from '../../common/errors/app.exception';
import {
  IS_OPTIONAL_AUTH_KEY,
  IS_PUBLIC_KEY,
  SKIP_EMAIL_VERIFICATION,
  RequestUser,
} from '../../common/decorators';

/**
 * Registered globally in AppModule: every route is authenticated unless it is
 * explicitly marked `@Public()`. Defaulting to closed means a new endpoint
 * cannot accidentally ship without auth.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Optional-auth routes still run the strategy - that is the whole point,
    // so a signed-in caller is identified - but a missing or bad token is not
    // fatal. handleRequest below turns the failure into an anonymous request.
    return super.canActivate(context);
  }

  private isOptional(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  handleRequest<TUser = RequestUser>(
    err: unknown,
    user: TUser | false,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    const optional = this.isOptional(context);

    if (err) {
      if (optional) return undefined as TUser;
      throw err;
    }

    if (!user) {
      // An anonymous caller on an optional route is expected, not an error.
      if (optional) return undefined as TUser;

      const reason = (info as Error | undefined)?.name;
      if (reason === 'TokenExpiredError') {
        throw AppException.unauthorized(ErrorCode.TOKEN_EXPIRED, 'Your session expired.');
      }
      throw AppException.unauthorized(ErrorCode.UNAUTHENTICATED);
    }

    const typed = user as unknown as RequestUser;

    // Gate gameplay behind a verified address when the deployment requires it,
    // while still letting the player reach the endpoints needed to verify.
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_EMAIL_VERIFICATION, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (
      !skip &&
      this.config.auth.requireVerifiedEmail &&
      !typed.emailVerified &&
      typed.status === UserStatus.PENDING_VERIFICATION
    ) {
      throw AppException.forbidden(ErrorCode.EMAIL_NOT_VERIFIED);
    }

    return user as TUser;
  }
}
