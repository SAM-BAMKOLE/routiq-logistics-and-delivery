import { randomBytes } from 'node:crypto';

/**
 * Generates the public tracking token: a 32-hex-character secret bound to one
 * shipment, presented as the second factor of `GET /public/tracking/:number`.
 *
 * 16 random bytes (128 bits) make guessing infeasible; `randomBytes` is the
 * CSPRNG, not the predictable `Math.random`. Like the tracking number it is
 * generated once at creation and never rotated in phase 1 (rotation lands
 * with the customer-portal work).
 */
export function generatePublicToken(): string {
  return randomBytes(16).toString('hex');
}
