/**
 * Tracking numbers: `SHP-` plus 12 Crockford base32 characters (60 bits of
 * entropy). The randomness is injected as bytes so the generator stays pure
 * and deterministic under test; production passes `crypto.randomBytes(8)`.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 12;

export function generateTrackingNumber(bytes: Uint8Array): string {
  if (bytes.length < 8) {
    throw new Error('Tracking number generation needs at least 8 random bytes.');
  }
  let value = 0n;
  for (let i = 0; i < 8; i += 1) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  // 64 bits down to the 60 the alphabet encodes; drop the excess top bits.
  value &= (1n << 60n) - 1n;

  let code = '';
  for (let i = 0; i < LENGTH; i += 1) {
    code = ALPHABET[Number(value & 31n)] + code;
    value >>= 5n;
  }
  return `SHP-${code}`;
}
