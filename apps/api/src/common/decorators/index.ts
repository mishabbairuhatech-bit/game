import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { UserRole } from '@empire/shared';

/* -------------------------------------------------------------------------- */
/* Route metadata                                                              */
/* -------------------------------------------------------------------------- */

export const IS_PUBLIC_KEY = 'isPublic';
/** Skips JwtAuthGuard entirely. `req.user` is never populated. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';
/**
 * Reachable without a token, but still identifies the caller when one is sent.
 *
 * `@Public()` is the wrong tool for a route that merely *tolerates* anonymity:
 * it short-circuits the guard, so `@CurrentUser()` stays undefined even for a
 * signed-in player. The map needs both - anyone may look at the world, but a
 * signed-in player must see which plots are theirs and what they may do.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);

export const ROLES_KEY = 'roles';
/** Minimum role required. RolesGuard compares by rank, not equality. */
export const RequireRole = (role: UserRole) => SetMetadata(ROLES_KEY, role);

export const SKIP_EMAIL_VERIFICATION = 'skipEmailVerification';
export const AllowUnverified = () => SetMetadata(SKIP_EMAIL_VERIFICATION, true);

/** Convenience: bearer-auth swagger annotations in one place. */
export const Authenticated = () =>
  applyDecorators(
    ApiBearerAuth('access-token'),
    ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' }),
  );

/* -------------------------------------------------------------------------- */
/* Param decorators                                                            */
/* -------------------------------------------------------------------------- */

export interface RequestUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  status: string;
  emailVerified: boolean;
}

/**
 * `@CurrentUser()` -> the whole user, `@CurrentUser('id')` -> just the id.
 * Populated by JwtStrategy after the token is verified against the database.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);

/** Client IP, honouring the X-Forwarded-For that NGINX sets. */
export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim();
  return req.ip;
});

export const UserAgent = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.headers['user-agent'] ?? null;
});

export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return (req.headers['x-request-id'] as string) ?? null;
});
