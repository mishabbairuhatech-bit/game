import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiSuccess } from '@empire/shared';

/**
 * Opt out for endpoints that must return a raw body - OAuth redirects,
 * webhook acknowledgements a provider expects verbatim, file downloads.
 */
export const RAW_RESPONSE = 'raw_response';
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/**
 * Wraps every successful controller return value in the shared envelope so
 * the client has exactly one success shape to parse.
 *
 * A controller that already returns `{ success: true, ... }` is passed through
 * untouched, which keeps hand-built responses (health checks) valid.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccess<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T> | T> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (raw) return next.handle();

    return next.handle().pipe(
      map((data) => {
        if (data !== null && typeof data === 'object' && 'success' in (data as object)) {
          return data;
        }
        // `meta` lets a service attach pagination info without the controller
        // having to hand-assemble the envelope.
        if (
          data !== null &&
          typeof data === 'object' &&
          '__meta' in (data as Record<string, unknown>)
        ) {
          const { __meta, ...rest } = data as Record<string, unknown>;
          return {
            success: true as const,
            data: rest as T,
            meta: __meta as Record<string, unknown>,
          };
        }
        return { success: true as const, data: data as T };
      }),
    );
  }
}
