import {
  deriveOtpPepper,
  generateDeliveryOtp,
  hashDeliveryOtp,
  verifyDeliveryOtp,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_HOURS,
} from './delivery-otp.js';

const PEPPER = deriveOtpPepper('test-jwt-secret');
const SHIPMENT = '3f1d2a60-8f3e-4a2c-9a1b-0c9d8e7f6a5b';

describe('delivery OTP', () => {
  it('generates six-digit codes, zero-padded', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateDeliveryOtp()).toMatch(/^\d{6}$/);
    }
  });

  it('derives a stable pepper from the secret', () => {
    expect(deriveOtpPepper('secret-a')).toBe(deriveOtpPepper('secret-a'));
    expect(deriveOtpPepper('secret-a')).not.toBe(
      deriveOtpPepper('secret-b'),
    );
  });

  it('verifies the right code and rejects wrong ones', () => {
    const code = '048291';
    const hash = hashDeliveryOtp(PEPPER, SHIPMENT, code);
    expect(verifyDeliveryOtp(PEPPER, SHIPMENT, code, hash)).toBe(true);
    expect(verifyDeliveryOtp(PEPPER, SHIPMENT, '048292', hash)).toBe(false);
  });

  it('binds the hash to the shipment: another shipment’s row never matches', () => {
    const code = '048291';
    const hash = hashDeliveryOtp(PEPPER, SHIPMENT, code);
    expect(
      verifyDeliveryOtp(PEPPER, '9d8e7f6a-5b4c-4a3b-9a1b-0c9d8e7f6a5b', code, hash),
    ).toBe(false);
  });

  it('binds the hash to the pepper: a leaked database row alone is useless', () => {
    const code = '048291';
    const hash = hashDeliveryOtp(PEPPER, SHIPMENT, code);
    expect(verifyDeliveryOtp('another-pepper', SHIPMENT, code, hash)).toBe(
      false,
    );
  });

  it('refuses malformed codes without touching the comparison', () => {
    const hash = hashDeliveryOtp(PEPPER, SHIPMENT, '048291');
    for (const bad of ['', '48291', '0482910', 'abcdef', '04829 ', "048'1"]) {
      expect(verifyDeliveryOtp(PEPPER, SHIPMENT, bad, hash)).toBe(false);
    }
  });

  it('exposes sane operational limits', () => {
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    expect(OTP_TTL_HOURS).toBe(24);
  });
});
