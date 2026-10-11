import { Logger } from '@nestjs/common';
import type { EmailMessage, EmailPort } from '../application/email.port.js';

/**
 * Local-development adapter: prints the rendered message to the log instead
 * of dialing Gmail, so the whole pipeline (events, quota, dedupe, templates)
 * runs offline with zero configuration.
 */
export class ConsoleEmailAdapter implements EmailPort {
  private readonly logger = new Logger('Email/console');

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(
      [
        `To: ${message.to}`,
        `From: ${message.fromName ?? 'LDMS'}${message.replyTo ? ` <reply-to: ${message.replyTo}>` : ''}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
      ].join('\n'),
    );
  }
}
