import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@empire/shared';
import { AppException } from './app.exception';

describe('AppException', () => {
  it('carries the machine code into the response body', () => {
    const error = AppException.badRequest(ErrorCode.INSUFFICIENT_COINS);
    const body = error.getResponse() as { code: string; message: string };

    expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(body.code).toBe('INSUFFICIENT_COINS');
    // The shared error catalogue supplies the default copy so the client and
    // the server never disagree about what a code means.
    expect(body.message).toBe('Not enough coins.');
  });

  it('lets the caller override the message without changing the code', () => {
    const error = AppException.forbidden(ErrorCode.ACCOUNT_BANNED, 'Banned for cheating.');
    const body = error.getResponse() as { code: string; message: string };

    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(body.code).toBe('ACCOUNT_BANNED');
    expect(body.message).toBe('Banned for cheating.');
  });

  it('maps each factory to the right status', () => {
    expect(AppException.unauthorized().getStatus()).toBe(401);
    expect(AppException.forbidden().getStatus()).toBe(403);
    expect(AppException.notFound().getStatus()).toBe(404);
    expect(AppException.conflict().getStatus()).toBe(409);
    expect(AppException.unprocessable(ErrorCode.VALIDATION_ERROR).getStatus()).toBe(422);
    expect(AppException.tooManyRequests().getStatus()).toBe(429);
    expect(AppException.internal().getStatus()).toBe(500);
    expect(AppException.serviceUnavailable().getStatus()).toBe(503);
  });

  it('keeps details off the body but available on the instance', () => {
    const error = AppException.badRequest(ErrorCode.VALIDATION_ERROR, undefined, {
      field: 'price',
    });
    expect(error.details).toEqual({ field: 'price' });
    expect(error.getResponse()).not.toHaveProperty('details');
  });

  it('falls back to a generic message for an unknown code', () => {
    const body = new AppException('SOMETHING_NEW').getResponse() as { message: string };
    expect(body.message).toBe('Unexpected error.');
  });
});
