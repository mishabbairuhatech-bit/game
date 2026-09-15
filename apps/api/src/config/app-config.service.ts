import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from './configuration';

/**
 * Thin, fully typed wrapper over Nest's ConfigService. Injecting this instead
 * of ConfigService means no stringly-typed `get('auth.jwtSecret')` calls and
 * no `!` assertions scattered through the codebase.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<{ app: AppConfig }, true>) {}

  get all(): AppConfig {
    return this.config.get('app', { infer: true }) as AppConfig;
  }

  get env() {
    return this.all.env;
  }
  get isProduction() {
    return this.all.isProduction;
  }
  get port() {
    return this.all.port;
  }
  get version() {
    return this.all.version;
  }
  get apiPrefix() {
    return this.all.apiPrefix;
  }
  get swaggerEnabled() {
    return this.all.swaggerEnabled;
  }
  get database() {
    return this.all.database;
  }
  get redis() {
    return this.all.redis;
  }
  get auth() {
    return this.all.auth;
  }
  get google() {
    return this.all.google;
  }
  get cors() {
    return this.all.cors;
  }
  get urls() {
    return this.all.urls;
  }
  get mail() {
    return this.all.mail;
  }
  get payments() {
    return this.all.payments;
  }
  get rateLimit() {
    return this.all.rateLimit;
  }
  get seed() {
    return this.all.seed;
  }
  get logging() {
    return this.all.logging;
  }
  get cookies() {
    return this.all.cookies;
  }
}
