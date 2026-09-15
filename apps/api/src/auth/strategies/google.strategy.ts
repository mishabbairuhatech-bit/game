import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { AppConfigService } from '../../config/app-config.service';

export interface GoogleProfilePayload {
  providerUserId: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
}

/**
 * Google OAuth 2.0.
 *
 * Registered conditionally (see AuthModule): with no GOOGLE_CLIENT_ID the
 * strategy is never constructed and /auth/google returns
 * OAUTH_PROVIDER_DISABLED, so the stack still boots on a fresh clone with an
 * unfilled .env.
 *
 * The strategy only *authenticates*. Account lookup, linking and creation all
 * happen in AuthService.findOrCreateOAuthUser, so local and OAuth signups
 * converge on exactly one provisioning path.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(config: AppConfigService) {
    super({
      clientID: config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackURL: config.google.callbackUrl,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0];

    if (!email?.value) {
      done(new Error('Google did not return an email address for this account.'));
      return;
    }

    // Google marks unverified addresses; accepting one would let someone
    // claim an account for an address they do not control. The provider's
    // typings vary between boolean and string across versions, so normalise.
    const verified = String((email as { verified?: unknown }).verified ?? 'true');
    if (verified === 'false') {
      done(new Error('This Google account has an unverified email address.'));
      return;
    }

    const payload: GoogleProfilePayload = {
      providerUserId: profile.id,
      email: email.value.toLowerCase(),
      displayName: profile.displayName,
      avatarUrl: profile.photos?.[0]?.value,
    };

    done(null, payload);
  }
}
