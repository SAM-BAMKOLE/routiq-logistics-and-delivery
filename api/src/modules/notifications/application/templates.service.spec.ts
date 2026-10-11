import { TemplatesService } from './templates.service.js';

/**
 * Every template in `../templates` must render all three of its parts with
 * plausible data — this doubles as a guard against a file being renamed or
 * deleted without updating the listeners that reference it.
 */
describe('TemplatesService', () => {
  const branding = {
    tenantName: 'Acme Logistics',
    logoUrl: null,
    accentColor: '#2563eb',
  };

  const samples: Record<string, { data: Record<string, unknown>; mentions: string }> = {
    'invite-user': {
      data: {
        ...branding,
        role: 'dispatcher',
        inviteUrl: 'http://localhost:5173/accept-invite?token=deadbeef',
        expiresInDays: 7,
      },
      mentions: 'accept-invite?token=deadbeef',
    },
    'reset-password': {
      data: {
        ...branding,
        resetUrl: 'http://localhost:5173/reset-password?token=cafebabe',
        expiresInMinutes: 60,
      },
      mentions: 'reset-password?token=cafebabe',
    },
    'shipment-confirmed': {
      data: { ...branding, customerName: 'Ada', trackingNumber: 'SHP-QQQ111222333' },
      mentions: 'SHP-QQQ111222333',
    },
    'driver-assigned': {
      data: { ...branding, customerName: 'Ada', trackingNumber: 'SHP-QQQ111222333' },
      mentions: 'SHP-QQQ111222333',
    },
    'out-for-delivery': {
      data: { ...branding, customerName: 'Ada', trackingNumber: 'SHP-QQQ111222333' },
      mentions: 'SHP-QQQ111222333',
    },
    'delivered-receipt': {
      data: { ...branding, customerName: 'Ada', trackingNumber: 'SHP-QQQ111222333' },
      mentions: 'SHP-QQQ111222333',
    },
    'failed-attempt': {
      data: {
        ...branding,
        customerName: 'Ada',
        trackingNumber: 'SHP-QQQ111222333',
        reason: 'nobody home',
        failedAttempts: 2,
      },
      mentions: 'nobody home',
    },
  };

  const service = new TemplatesService();

  for (const [template, sample] of Object.entries(samples)) {
    it(`renders subject, html, and text for ${template}`, () => {
      const rendered = service.render(template, sample.data);

      expect(rendered.subject).not.toContain('\n');
      expect(rendered.subject.trim().length).toBeGreaterThan(0);
      expect(rendered.html).toContain('<!DOCTYPE html>');
      expect(rendered.html).toContain('Acme Logistics');
      expect(rendered.text).toContain(sample.mentions);
      // The text part is plain text, never markup.
      expect(rendered.text).not.toContain('<html');
    });
  }

  it('has a template set for every name the listeners reference', () => {
    const referenced = [
      'invite-user',
      'reset-password',
      'shipment-confirmed',
      'driver-assigned',
      'out-for-delivery',
      'delivered-receipt',
      'failed-attempt',
    ];
    expect(Object.keys(samples).sort()).toEqual([...referenced].sort());
  });

  it('escapes data in the HTML body while keeping text literal', () => {
    const data = { ...samples['invite-user'].data, tenantName: 'A & B' };
    const rendered = service.render('invite-user', data);

    expect(rendered.html).toContain('A &amp; B');
    expect(rendered.text).toContain('A & B');
  });

  it('fails loudly on an unknown template instead of mailing a stub', () => {
    expect(() => service.render('no-such-template', {})).toThrow(/ENOENT|no-such-template/);
  });
});
