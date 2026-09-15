import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ErrorCode } from '@empire/shared';
import { AppConfigService } from '../../config/app-config.service';
import { AppException } from '../../common/errors/app.exception';

/**
 * Wraps the passport Google guard with a configuration check.
 *
 * Without this, hitting /auth/google on a server that has no GOOGLE_CLIENT_ID
 * produces an opaque "Unknown authentication strategy" 500. A clone-and-run
 * developer should instead get a clear, structured
 * OAUTH_PROVIDER_DISABLED response.
 */
@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  constructor(private readonly config: AppConfigService) {
    super({ session: false });
  }

  canActivate(context: ExecutionContext) {
    if (!this.config.google.enabled) {
      throw AppException.badRequest(
        ErrorCode.OAUTH_PROVIDER_DISABLED,
        'Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }
    return super.canActivate(context);
  }
}
