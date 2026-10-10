import { generateTrackingNumber } from './tracking-number.js';

describe('generateTrackingNumber', () => {
  it('encodes zero bytes as an all-zero code', () => {
    expect(generateTrackingNumber(new Uint8Array(8))).toBe('SHP-000000000000');
  });

  it('encodes full entropy as all-Z (the alphabet top)', () => {
    expect(generateTrackingNumber(new Uint8Array(8).fill(0xff))).toBe(
      'SHP-ZZZZZZZZZZZZ',
    );
  });

  it('always produces the SHP- prefix and 12 Crockford characters', () => {
    for (let i = 0; i < 50; i += 1) {
      const bytes = new Uint8Array(8).map(() => (i * 37 + 11) % 256);
      expect(generateTrackingNumber(bytes)).toMatch(
        /^SHP-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$/,
      );
    }
  });

  it('differs for different byte patterns', () => {
    const a = generateTrackingNumber(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const b = generateTrackingNumber(new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]));
    expect(a).not.toBe(b);
  });

  it('refuses to run short of entropy', () => {
    expect(() => generateTrackingNumber(new Uint8Array(4))).toThrow();
  });
});
