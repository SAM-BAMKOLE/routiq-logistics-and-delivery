import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { NotifyInput, NotificationsService } from './notifications.service.js';
import { IdentityEmailsListener } from './identity-emails.listener.js';
import { createEnvelope } from '../../../shared/messaging/event-envelope.js';

function makeHarness(baseUrl = 'http://localhost:5173/') {
  const notify = jest
    .fn<(...args: [NotifyInput]) => Promise<string>>()
    .mockResolvedValue('sent');
  const notifications = { notify } as unknown as NotificationsService;
  const config = {
    get: (key: string) => (key === 'APP_BASE_URL' ? baseUrl : undefined),
  } as ConfigService;
  const listener = new IdentityEmailsListener(notifications, config);
  return { listener, notify };
}

describe('IdentityEmailsListener', () => {
  it('mails the invite link as critical mail from the invite event', async () => {
    const { listener, notify } = makeHarness();

    await listener.onInvited(
      createEnvelope({
        type: 'UserInvited',
        tenantId: 't-1',
        aggregateType: 'membership',
        aggregateId: 'm-1',
        payload: {
          email: 'New@Example.com',
          role: 'dispatcher',
          inviteToken: 'a'.repeat(64),
        },
      }),
    );

    expect(notify).toHaveBeenCalledTimes(1);
    const input = notify.mock.calls[0][0];
    expect(input).toMatchObject({
      tenantId: 't-1',
      template: 'invite-user',
      priority: 'critical',
      recipient: 'New@Example.com',
      dedupeKey: expect.stringContaining(':invite-user:New@Example.com'),
    });
    // Trailing slash is normalized off the base URL.
    expect(input.data['inviteUrl']).toBe(
      `http://localhost:5173/accept-invite?token=${'a'.repeat(64)}`,
    );
  });

  it('ignores a malformed invite event instead of mailing junk', async () => {
    const { listener, notify } = makeHarness();

    await listener.onInvited(
      createEnvelope({
        type: 'UserInvited',
        tenantId: 't-1',
        aggregateType: 'membership',
        aggregateId: 'm-1',
        payload: { email: 'someone@example.com' }, // no token
      }),
    );

    expect(notify).not.toHaveBeenCalled();
  });

  it('mails the reset link when the event carries a token', async () => {
    const { listener, notify } = makeHarness('https://go.example');

    await listener.onPasswordReset(
      createEnvelope({
        type: 'PasswordResetRequested',
        aggregateType: 'user',
        aggregateId: 'u-1',
        payload: { email: 'someone@example.com', resetToken: 'b'.repeat(64) },
      }),
    );

    expect(notify).toHaveBeenCalledTimes(1);
    const input = notify.mock.calls[0][0];
    expect(input).toMatchObject({
      tenantId: null, // global mail: no tenant branding to apply
      template: 'reset-password',
      priority: 'critical',
      recipient: 'someone@example.com',
    });
    expect(input.data['resetUrl']).toBe(
      `https://go.example/reset-password?token=${'b'.repeat(64)}`,
    );
  });

  it('stays silent when the reset was for an unknown address', async () => {
    const { listener, notify } = makeHarness();

    await listener.onPasswordReset(
      createEnvelope({
        type: 'PasswordResetRequested',
        aggregateType: 'user',
        aggregateId: 'ghost@example.com',
        payload: { email: 'ghost@example.com', resetToken: null },
      }),
    );

    expect(notify).not.toHaveBeenCalled();
  });
});
