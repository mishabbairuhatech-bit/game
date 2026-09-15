import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Pluggable mailer.
 *
 * The `log` driver (the default in development) writes the message - including
 * the verification / reset link - to the API log, so the whole auth flow is
 * exercisable end to end with `docker compose logs -f backend` and no SMTP
 * account. Swapping in a real transport is a driver change, not a call-site
 * change.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: AppConfigService) {}

  async send(message: MailMessage): Promise<void> {
    if (this.config.mail.driver === 'smtp') {
      await this.sendSmtp(message);
      return;
    }
    this.logger.log(
      `\n` +
        `+--------------------------- OUTGOING MAIL ---------------------------+\n` +
        `| To:      ${message.to}\n` +
        `| From:    ${this.config.mail.from}\n` +
        `| Subject: ${message.subject}\n` +
        `+---------------------------------------------------------------------+\n` +
        `${message.text}\n` +
        `+---------------------------------------------------------------------+`,
    );
  }

  async sendVerificationEmail(to: string, username: string, token: string): Promise<void> {
    const link = `${this.config.urls.web}/verify-email?token=${encodeURIComponent(token)}`;
    await this.send({
      to,
      subject: 'Confirm your Empire Frontier account',
      text:
        `Commander ${username},\n\n` +
        `Confirm this address to claim your starting territory:\n\n${link}\n\n` +
        `The link expires in ${this.config.auth.emailVerificationTtlHours} hours. ` +
        `If you did not create this account you can ignore this message.`,
    });
  }

  async sendPasswordResetEmail(to: string, username: string, token: string): Promise<void> {
    const link = `${this.config.urls.web}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send({
      to,
      subject: 'Reset your Empire Frontier password',
      text:
        `Commander ${username},\n\n` +
        `Use this link to choose a new password:\n\n${link}\n\n` +
        `It expires in ${this.config.auth.passwordResetTtlMinutes} minutes and can be used once. ` +
        `If you did not request this, no action is needed - your password has not changed.`,
    });
  }

  /**
   * SMTP is intentionally not wired to a hard dependency yet. Configuring
   * MAIL_DRIVER=smtp without adding a transport is a misconfiguration, and
   * failing loudly beats silently dropping account-recovery mail.
   */
  private async sendSmtp(message: MailMessage): Promise<void> {
    this.logger.error(
      `MAIL_DRIVER=smtp but no SMTP transport is installed. ` +
        `Message to ${message.to} ("${message.subject}") was NOT sent. ` +
        `Add nodemailer and implement MailService.sendSmtp, or set MAIL_DRIVER=log.`,
    );
    throw new Error('SMTP transport is not configured.');
  }
}
