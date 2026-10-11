import { Injectable } from '@nestjs/common';
import type { EmailMessage, EmailPort } from '../application/email.port.js';

/**
 * Test adapter: collects messages in memory so specs can assert on
 * recipients, subjects, and rendered bodies without a network. Selected
 * automatically whenever `NODE_ENV=test`, unless `EMAIL_ADAPTER` says
 * otherwise.
 */
@Injectable()
export class InMemoryEmailAdapter implements EmailPort {
  private readonly collected: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.collected.push(message);
  }

  /** Every message sent so far, oldest first. */
  sent(): readonly EmailMessage[] {
    return [...this.collected];
  }

  /** The most recent message matching a recipient, or undefined. */
  lastTo(recipient: string): EmailMessage | undefined {
    const normalized = recipient.trim().toLowerCase();
    return [...this.collected]
      .reverse()
      .find((message) => message.to === normalized);
  }

  clear(): void {
    this.collected.length = 0;
  }
}
