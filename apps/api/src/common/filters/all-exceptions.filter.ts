import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { ErrorCode, ApiFailure, messageFor } from '@empire/shared';
import { AppException } from '../errors/app.exception';

/**
 * Single exit point for every failure. Guarantees that a client never sees a
 * stack trace, a raw Prisma message, or an unshaped body - the contract is
 * always { success: false, error: { code, message, ... } }.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request?.headers?.['x-request-id'] as string) ?? undefined;

    const { status, code, message, details } = this.normalise(exception);

    const body: ApiFailure = {
      success: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    // 5xx is our bug; log the whole thing. 4xx is the caller's problem; one line.
    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId, path: request?.url, method: request?.method },
        `${status} ${code} ${message}`,
      );
    } else {
      this.logger.debug(`${status} ${code} ${request?.method} ${request?.url}`);
    }

    if (response.headersSent) return;
    response.status(status).json(body);
  }

  private normalise(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof AppException) {
      const res = exception.getResponse() as { code: string; message: string };
      return {
        status: exception.getStatus(),
        code: res.code,
        message: res.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      // class-validator failures arrive as { message: string[] , error, statusCode }
      if (typeof res === 'object' && res !== null) {
        const r = res as Record<string, unknown>;
        if (Array.isArray(r.message)) {
          return {
            status,
            code: ErrorCode.VALIDATION_ERROR,
            message: messageFor(ErrorCode.VALIDATION_ERROR),
            details: r.message,
          };
        }
        if (typeof r.code === 'string') {
          return {
            status,
            code: r.code,
            message: typeof r.message === 'string' ? r.message : messageFor(r.code),
          };
        }
        if (typeof r.message === 'string') {
          return { status, code: this.codeForStatus(status), message: r.message };
        }
      }

      return {
        status,
        code: this.codeForStatus(status),
        message: typeof res === 'string' ? res : exception.message,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: messageFor(ErrorCode.VALIDATION_ERROR),
      };
    }

    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'The game database is unavailable. Please try again shortly.',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: messageFor(ErrorCode.INTERNAL_ERROR),
      // Never leak internals to a production client.
      details:
        !this.isProduction && exception instanceof Error
          ? { name: exception.name, message: exception.message }
          : undefined,
    };
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError) {
    switch (e.code) {
      case 'P2002': {
        const target = (e.meta?.target as string[] | string | undefined) ?? [];
        const fields = Array.isArray(target) ? target : [target];
        // Map the unique constraints the client can actually trigger.
        if (fields.some((f) => f.includes('email'))) {
          return {
            status: HttpStatus.CONFLICT,
            code: ErrorCode.EMAIL_ALREADY_REGISTERED,
            message: messageFor(ErrorCode.EMAIL_ALREADY_REGISTERED),
          };
        }
        if (fields.some((f) => f.includes('username'))) {
          return {
            status: HttpStatus.CONFLICT,
            code: ErrorCode.USERNAME_TAKEN,
            message: messageFor(ErrorCode.USERNAME_TAKEN),
          };
        }
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          message: 'That value is already taken.',
          details: { fields },
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: ErrorCode.NOT_FOUND,
          message: messageFor(ErrorCode.NOT_FOUND),
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: ErrorCode.VALIDATION_ERROR,
          message: 'A referenced record does not exist.',
        };
      case 'P2034':
        // Write conflict / deadlock - the caller may safely retry.
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          message: 'That action collided with another. Please try again.',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ErrorCode.INTERNAL_ERROR,
          message: messageFor(ErrorCode.INTERNAL_ERROR),
          details: this.isProduction ? undefined : { prismaCode: e.code },
        };
    }
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case 400:
        return ErrorCode.BAD_REQUEST;
      case 401:
        return ErrorCode.UNAUTHENTICATED;
      case 403:
        return ErrorCode.FORBIDDEN;
      case 404:
        return ErrorCode.NOT_FOUND;
      case 409:
        return ErrorCode.CONFLICT;
      case 422:
        return ErrorCode.VALIDATION_ERROR;
      case 429:
        return ErrorCode.RATE_LIMITED;
      case 503:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST;
    }
  }
}
