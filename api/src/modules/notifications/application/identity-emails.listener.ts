import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventEnvelope } from '../../../shared/messaging/event-envelope.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Identity emails: invitations and password resets, both critical priority
 * (they are credentials, not updates).
 *
 * The raw one-time token rides in the event payload. That is deliberate for
 * phase 1: the bus is in-process and nothing is persisted, so the token
 * exists only between the service that minted it and the listener mailing
 * it. When phase 2 moves events through the outbox table, this payload must
 * become a reference the consumer resolves instead — noted here so the
 * swap is a conscious one.
 *
 * `PasswordResetRequested` is published for unknown addresses too (with a
 * null token), so responses stay identical either way and no account can be
 * enumerated. The listener just logs and stops.
 */
@Injectable()
export class IdentityEmailsListener {
  private readonly logger = new Logger(IdentityEmailsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent('UserInvited', { suppressErrors: false })
  async onInvited(event: DomainEventEnvelope): Promise<void> {
    const email = event.payload['email'];
    const inviteToken = event.payload['inviteToken'];
    if (typeof email !== 'string' || typeof inviteToken !== 'string') {
      return;
    }

    await this.notifications.notify({
      tenantId: event.tenantId,
      template: 'invite-user',
      recipient: email,
      priority: 'critical',
      dedupeKey: `${event.id}:invite-user:${email}`,
      data: {
        role: event.payload['role'] ?? 'member',
        inviteUrl: `${this.base()}/accept-invite?token=${inviteToken}`,
        expiresInDays: 7,
      },
    });
  }

  @OnEvent('PasswordResetRequested', { suppressErrors: false })
  async onPasswordReset(event: DomainEventEnvelope): Promise<void> {
    const email = event.payload['email'];
    const resetToken = event.payload['resetToken'];
    if (typeof email !== 'string') {
      return;
    }
    if (typeof resetToken !== 'string') {
      // Unknown address: publish the event so the response is identical,
      // then stop without mailing anything.
      this.logger.debug(
        { eventId: event.id },
        'password reset requested for an unknown address; nothing sent',
      );
      return;
    }

    await this.notifications.notify({
      tenantId: null,
      template: 'reset-password',
      recipient: email,
      priority: 'critical',
      dedupeKey: `${event.id}:reset-password:${email}`,
      data: {
        resetUrl: `${this.base()}/reset-password?token=${resetToken}`,
        expiresInMinutes: 60,
      },
    });
  }

  private base(): string {
    return (
      this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:5173'
    ).replace(/\/+$/, '');
  }
}
