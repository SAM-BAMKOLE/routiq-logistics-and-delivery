import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * The delivery OTP: a six-digit code the recipient reads to the driver,
 * proving the parcel reached a human.
 *
 * The plaintext exists only in two places — the email we send the customer
 * and the driver's screen while typing it back — and never in the database:
 * the shipments row keeps an HMAC of the code, an expiry, and an attempt
 * counter. The pepper is derived from the JWT secret, so a leaked database
 * dump alone cannot be brute-forced offline (six digits are guessable in
 * seconds without it).
 *
 * Attempts are capped rather than the code being single-use on failure:
 * a mistyped digit must not lock a customer out of their own delivery, but
 * five wrong guesses end the conversation.
 */

/** How long a code stays usable; generous enough for a slow delivery day. */
export const OTP_TTL_HOURS = 24;

/** Wrong guesses before the code stops working. */
export const OTP_MAX_ATTEMPTS = 5;

/** Derives the OTP pepper from the application secret. Stable per deploy. */
export function deriveOtpPepper(secret: string): string {
  return createHmac('sha256', secret).update('ldms.delivery-otp.v1').digest('hex');
}

/** A fresh six-digit code (`000000` is a valid code; no leading-zero traps). */
export function generateDeliveryOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * The stored form: HMAC-SHA256 over `shipmentId.code`, so one database row
 * cannot be reused for another shipment even if the codes collide.
 */
export function hashDeliveryOtp(
  pepper: string,
  shipmentId: string,
  code: string,
): string {
  return createHmac('sha256', pepper)
    .update(`${shipmentId}.${code}`)
    .digest('hex');
}

/** Constant-time comparison of a submitted code against the stored hash. */
export function verifyDeliveryOtp(
  pepper: string,
  shipmentId: string,
  code: string,
  storedHash: string,
): boolean {
  if (!/^\d{6}$/.test(code)) {
    return false;
  }
  const candidate = Buffer.from(
    hashDeliveryOtp(pepper, shipmentId, code),
    'hex',
  );
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
