import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ErrorCode, roleAtLeast, UserRole } from '@empire/shared';
import { AppException } from '../../common/errors/app.exception';
import { ROLES_KEY, RequestUser } from '../../common/decorators';

/**
 * Role check by rank, not equality: `@RequireRole('MODERATOR')` also admits
 * ADMIN and SUPER_ADMIN. Equality checks are the classic way an admin route
 * accidentally locks out the people who need it most.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const user = request.user;

    // No user here means JwtAuthGuard let the route through as @Public() while
    // also demanding a role - a wiring mistake, so fail closed.
    if (!user) throw AppException.unauthorized(ErrorCode.UNAUTHENTICATED);

    if (!roleAtLeast(user.role, required)) {
      throw AppException.forbidden(
        ErrorCode.INSUFFICIENT_ROLE,
        `This action requires the ${required} role.`,
      );
    }

    return true;
  }
}
