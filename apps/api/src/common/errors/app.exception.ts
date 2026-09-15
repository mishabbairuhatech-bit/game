import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, messageFor } from '@empire/shared';

/**
 * The only exception type application code should throw.
 *
 * Carrying a machine-readable `code` means the client can branch on
 * INSUFFICIENT_COINS without string-matching an English sentence, and the
 * global filter can serialise every failure identically.
 */
export class AppException extends HttpException {
  readonly code: string;
  readonly details?: unknown;

  constructor(
    code: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    message?: string,
    details?: unknown,
  ) {
    super({ code, message: message ?? messageFor(code) }, status);
    this.code = code;
    this.details = details;
  }

  /* ---- factories for the statuses we actually use ---------------------- */

  static badRequest(code: string, message?: string, details?: unknown) {
    return new AppException(code, HttpStatus.BAD_REQUEST, message, details);
  }

  static unauthorized(code: string = ErrorCode.UNAUTHENTICATED, message?: string) {
    return new AppException(code, HttpStatus.UNAUTHORIZED, message);
  }

  static forbidden(code: string = ErrorCode.FORBIDDEN, message?: string) {
    return new AppException(code, HttpStatus.FORBIDDEN, message);
  }

  static notFound(code: string = ErrorCode.NOT_FOUND, message?: string) {
    return new AppException(code, HttpStatus.NOT_FOUND, message);
  }

  /** Use for "someone else got there first" races - the client can retry. */
  static conflict(code: string = ErrorCode.CONFLICT, message?: string, details?: unknown) {
    return new AppException(code, HttpStatus.CONFLICT, message, details);
  }

  static unprocessable(code: string, message?: string, details?: unknown) {
    return new AppException(code, HttpStatus.UNPROCESSABLE_ENTITY, message, details);
  }

  static tooManyRequests(code: string = ErrorCode.RATE_LIMITED, message?: string) {
    return new AppException(code, HttpStatus.TOO_MANY_REQUESTS, message);
  }

  static internal(code: string = ErrorCode.INTERNAL_ERROR, message?: string, details?: unknown) {
    return new AppException(code, HttpStatus.INTERNAL_SERVER_ERROR, message, details);
  }

  static serviceUnavailable(code: string = ErrorCode.SERVICE_UNAVAILABLE, message?: string) {
    return new AppException(code, HttpStatus.SERVICE_UNAVAILABLE, message);
  }
}
