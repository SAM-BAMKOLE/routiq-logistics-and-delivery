import { Argon2PasswordHasher } from './argon2-password-hasher.js';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('hashes and verifies a password', async () => {
    const hash = await hasher.hash('correct-horse-123');
    expect(hash).not.toContain('correct-horse-123');
    expect(await hasher.verify(hash, 'correct-horse-123')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hasher.hash('correct-horse-123');
    expect(await hasher.verify(hash, 'wrong-password')).toBe(false);
  });

  it('fails closed on a malformed stored hash', async () => {
    expect(await hasher.verify('not-a-hash', 'anything')).toBe(false);
  });
});
