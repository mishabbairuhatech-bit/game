import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';

/**
 * Structured JSON logging.
 *
 * Every request gets an x-request-id (reusing NGINX's when present) which is
 * echoed on the response, attached to every log line for that request, and
 * included in error envelopes - so a player-reported error code can be traced
 * straight to its request in the logs.
 *
 * Redaction is deliberately broad: an auth header or a password that reaches
 * the log store is a breach, and log lines are the easiest place to leak one.
 */
@Module({
  imports: [
    AppConfigModule,
    PinoLoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logging.level,
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const existing = req.headers['x-request-id'];
            const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          transport: config.logging.pretty
            ? {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  colorize: true,
                  translateTime: 'HH:MM:ss.l',
                  ignore: 'pid,hostname,req.headers,res.headers',
                },
              }
            : undefined,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-csrf-token"]',
              'req.body.password',
              'req.body.newPassword',
              'req.body.currentPassword',
              'req.body.token',
              'req.body.refreshToken',
              'res.headers["set-cookie"]',
              '*.passwordHash',
              '*.tokenHash',
              '*.accessToken',
              '*.refreshToken',
            ],
            censor: '[redacted]',
          },
          customProps: () => ({ service: 'empire-frontier-api' }),
          // Health probes fire every 15s per container; logging them buries
          // everything else. Matched on the path only, so a query string
          // cannot smuggle a request past the filter.
          autoLogging: {
            ignore: (req: IncomingMessage) => {
              const path = (req.url ?? '').split('?')[0];
              return (
                path === '/api/health' ||
                path === '/api/ready' ||
                path === '/health' ||
                path === '/ready' ||
                path === '/metrics'
              );
            },
          },
          customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },
          serializers: {
            req: (req: IncomingMessage & { id?: string; method?: string; url?: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
