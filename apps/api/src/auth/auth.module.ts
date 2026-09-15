import { Module, Provider } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigModule } from '../config/config.module';
import { AppConfigService } from '../config/app-config.service';
import { PlayersModule } from '../players/players.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleOAuthGuard } from './guards/google-oauth.guard';

/**
 * GoogleStrategy is only instantiated when credentials are present. Passport
 * throws at construction time on an empty clientID, which would stop the whole
 * API from booting on a fresh clone - so registration is conditional and the
 * guard reports OAUTH_PROVIDER_DISABLED instead.
 */
const googleProvider: Provider = {
  provide: GoogleStrategy,
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) =>
    config.google.enabled ? new GoogleStrategy(config) : null,
};

@Module({
  imports: [
    AppConfigModule,
    PlayersModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.auth.jwtSecret,
        signOptions: {
          expiresIn: config.auth.accessTtlSeconds,
          issuer: 'empire-frontier',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtStrategy, GoogleOAuthGuard, googleProvider],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
