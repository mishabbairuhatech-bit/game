import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthProvider } from '@prisma/client';
import { Request, Response } from 'express';
import {
  ErrorCode,
  REFRESH_COOKIE_NAME,
  SESSION_HINT_COOKIE_NAME,
  AuthUser,
  LoginResult,
} from '@empire/shared';
import { AppConfigService } from '../config/app-config.service';
import { AppException } from '../common/errors/app.exception';
import {
  AllowUnverified,
  Authenticated,
  ClientIp,
  CurrentUser,
  Public,
  UserAgent,
} from '../common/decorators';
import { RawResponse } from '../common/interceptors/response.interceptor';
import { AuthService } from './auth.service';
import { GoogleOAuthGuard } from './guards/google-oauth.guard';
import { IssuedTokens } from './token.service';
import { GoogleProfilePayload } from './strategies/google.strategy';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

/** Tight per-IP budgets on the endpoints worth brute-forcing. */
const STRICT = { default: { limit: 8, ttl: 60_000 } };
const VERY_STRICT = { default: { limit: 4, ttl: 300_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  /* ====================================================================== */
  /* Registration & login                                                    */
  /* ====================================================================== */

  @Public()
  @Throttle(STRICT)
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an account and provision a starting empire.',
    description:
      'Creates the user, profile, wallet, empire, inventory and starting army in one ' +
      'transaction, then grants a starter plot if a world has been generated. ' +
      'The refresh token is set as an httpOnly cookie; the access token is in the body.',
  })
  @ApiCreatedResponse({ description: 'Account created and signed in.' })
  async register(
    @Body() dto: RegisterDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const result = await this.auth.register(dto, { ipAddress: ip, userAgent });
    this.setRefreshCookie(res, result.tokens);
    return this.toLoginResult(result.user, result.tokens);
  }

  @Public()
  @Throttle(STRICT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange email + password for an access token.' })
  @ApiOkResponse({ description: 'Signed in.' })
  async login(
    @Body() dto: LoginDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const result = await this.auth.login(dto.email, dto.password, {
      ipAddress: ip,
      userAgent,
    });
    this.setRefreshCookie(res, result.tokens);
    return this.toLoginResult(result.user, result.tokens);
  }

  /* ====================================================================== */
  /* Session                                                                 */
  /* ====================================================================== */

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token and mint a new access token.',
    description:
      'Browsers send the httpOnly cookie automatically. Native clients may post ' +
      'the token in the body instead. Presenting an already-rotated token revokes ' +
      'the entire session family.',
  })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const token = this.readRefreshToken(req, dto.refreshToken);
    if (!token) throw AppException.unauthorized(ErrorCode.UNAUTHENTICATED, 'No refresh token supplied.');

    const result = await this.auth.refresh(token, { ipAddress: ip, userAgent });
    this.setRefreshCookie(res, result.tokens);
    return this.toLoginResult(result.user, result.tokens);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current session and clear the refresh cookie.' })
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ loggedOut: true }> {
    const token = this.readRefreshToken(req, dto.refreshToken);
    await this.auth.logout(token);
    this.clearRefreshCookie(res);
    return { loggedOut: true };
  }

  @Authenticated()
  @AllowUnverified()
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke every session for the current account.' })
  async logoutAll(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ loggedOut: true }> {
    await this.auth.logoutEverywhere(userId);
    this.clearRefreshCookie(res);
    return { loggedOut: true };
  }

  @Authenticated()
  @AllowUnverified()
  @Get('me')
  @ApiOperation({ summary: 'The signed-in account.' })
  async me(@CurrentUser('id') userId: string): Promise<AuthUser> {
    return this.auth.getAuthUser(userId);
  }

  /* ====================================================================== */
  /* Email verification                                                      */
  /* ====================================================================== */

  @Public()
  @Throttle(VERY_STRICT)
  @Post('verify/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send a fresh verification link.',
    description:
      'Always returns 202, whether or not the address is registered, so this ' +
      'endpoint cannot be used to enumerate accounts.',
  })
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<{ sent: true }> {
    await this.auth.resendVerification(dto.email);
    return { sent: true };
  }

  @Public()
  @Throttle(STRICT)
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume an email verification token.' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<AuthUser> {
    return this.auth.verifyEmail(dto.token);
  }

  /* ====================================================================== */
  /* Password                                                                */
  /* ====================================================================== */

  @Public()
  @Throttle(VERY_STRICT)
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request a password reset link.',
    description: 'Always returns 202 regardless of whether the address exists.',
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string | null,
  ): Promise<{ sent: true }> {
    await this.auth.forgotPassword(dto.email, { ipAddress: ip, userAgent });
    return { sent: true };
  }

  @Public()
  @Throttle(STRICT)
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a new password using a reset token.',
    description: 'Revokes every existing session for the account.',
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ reset: true }> {
    await this.auth.resetPassword(dto.token, dto.password, { ipAddress: ip, userAgent });
    this.clearRefreshCookie(res);
    return { reset: true };
  }

  @Authenticated()
  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the password of the signed-in account.' })
  @ApiBody({ type: ChangePasswordDto })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent: string | null,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ changed: true }> {
    await this.auth.changePassword(userId, dto.currentPassword, dto.newPassword, {
      ipAddress: ip,
      userAgent,
    });
    this.clearRefreshCookie(res);
    return { changed: true };
  }

  /* ====================================================================== */
  /* Google OAuth                                                            */
  /* ====================================================================== */

  @Public()
  @UseGuards(GoogleOAuthGuard)
  @Get('google')
  @RawResponse()
  @ApiOperation({
    summary: 'Begin the Google OAuth flow.',
    description:
      'Redirects to Google\'s consent screen. Responds with ' +
      'OAUTH_PROVIDER_DISABLED when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are ' +
      'not set, so the stack still runs on a fresh clone.',
  })
  googleStart(): void {
    // The guard performs the redirect to Google; this body never executes.
  }

  @Public()
  @UseGuards(GoogleOAuthGuard)
  @Get('google/callback')
  @ApiExcludeEndpoint()
  @RawResponse()
  async googleCallback(
    @Req() req: Request & { user?: GoogleProfilePayload },
    @ClientIp() ip: string,
    @UserAgent() userAgent: string | null,
    @Res() res: Response,
  ): Promise<void> {
    const profile = req.user;
    if (!profile) {
      res.redirect(302, `${this.config.urls.web}/login?error=oauth_failed`);
      return;
    }

    try {
      const result = await this.auth.findOrCreateOAuthUser(AuthProvider.GOOGLE, profile, {
        ipAddress: ip,
        userAgent,
      });
      this.setRefreshCookie(res, result.tokens);

      // The access token is handed over in the URL fragment: fragments are
      // never sent to the server and never land in access logs. The SPA reads
      // it, keeps it in memory, and strips it from the address bar.
      res.redirect(
        302,
        `${this.config.urls.web}/auth/callback#access_token=${encodeURIComponent(
          result.tokens.accessToken,
        )}&expires_in=${result.tokens.expiresIn}`,
      );
    } catch (error) {
      const code = error instanceof AppException ? error.code : 'oauth_failed';
      res.redirect(302, `${this.config.urls.web}/login?error=${encodeURIComponent(code)}`);
    }
  }

  /* ====================================================================== */
  /* Helpers                                                                 */
  /* ====================================================================== */

  private toLoginResult(user: AuthUser, tokens: IssuedTokens): LoginResult {
    return {
      user,
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer',
    };
  }

  /**
   * The refresh token lives in an httpOnly, SameSite cookie scoped to the auth
   * routes. Keeping it out of JavaScript means an XSS bug cannot walk off with
   * a 30-day credential; the short-lived access token stays in memory only.
   */
  private setRefreshCookie(res: Response, tokens: IssuedTokens): void {
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
      httpOnly: true,
      secure: this.config.cookies.secure,
      sameSite: this.config.cookies.sameSite,
      domain: this.config.cookies.domain,
      path: '/api',
      expires: tokens.refreshExpiresAt,
    });

    // Readable companion flag. Holds no secret - it only tells the client that
    // attempting a refresh is worthwhile, so a first-time visitor does not
    // trigger a pointless 401 on every cold load.
    res.cookie(SESSION_HINT_COOKIE_NAME, '1', {
      httpOnly: false,
      secure: this.config.cookies.secure,
      sameSite: this.config.cookies.sameSite,
      domain: this.config.cookies.domain,
      path: '/',
      expires: tokens.refreshExpiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: this.config.cookies.secure,
      sameSite: this.config.cookies.sameSite,
      domain: this.config.cookies.domain,
      path: '/api',
    });
    res.clearCookie(SESSION_HINT_COOKIE_NAME, {
      httpOnly: false,
      secure: this.config.cookies.secure,
      sameSite: this.config.cookies.sameSite,
      domain: this.config.cookies.domain,
      path: '/',
    });
  }

  private readRefreshToken(req: Request, fromBody?: string): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[REFRESH_COOKIE_NAME] ?? fromBody;
  }
}
