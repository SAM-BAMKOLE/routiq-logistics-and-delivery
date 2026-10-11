import type { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, EmailPort } from '../application/email.port.js';

/**
 * Gmail SMTP adapter for staging and demo: Nodemailer over
 * `smtp.gmail.com:465` (implicit TLS), authenticated with an App Password.
 *
 * - The sender address is always the authenticated Gmail account (Gmail
 *   rewrites it), so the tenant's name rides in the display name and its
 *   contact address in `Reply-To`.
 * - A small connection pool plus a send rate limit keeps a burst of
 *   notifications from tripping Gmail's throttling. The account's daily
 *   allowance (~500) is guarded in `NotificationsService`, before this
 *   adapter is ever reached.
 */
export class GmailSmtpAdapter implements EmailPort {
  private readonly user: string;
  private readonly transporter: Transporter;

  constructor(config: ConfigService) {
    this.user = config.getOrThrow<string>('SMTP_USER');
    const password = config.getOrThrow<string>('SMTP_PASSWORD');
    this.transporter = createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { type: 'login', user: this.user, pass: password },
      pool: true,
      maxConnections: 2,
      // Gentle on purpose: two messages per second is far below any limit
      // and still drains a day's quota in minutes if it ever came to that.
      rateDelta: 1000,
      rateLimit: 2,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from:
        message.fromName !== undefined
          ? `"${message.fromName.replace(/"/g, '')}" <${this.user}>`
          : this.user,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
  }
}
