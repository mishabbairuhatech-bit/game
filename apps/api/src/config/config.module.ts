import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { loadConfiguration } from './configuration';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Env comes from docker-compose `env_file` / `environment`. The local
      // .env is a convenience for running the API outside a container.
      envFilePath: ['.env', '../../.env'],
      load: [() => ({ app: loadConfiguration() })],
      expandVariables: true,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
