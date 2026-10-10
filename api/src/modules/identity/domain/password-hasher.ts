/** DI token for the {@link PasswordHasher} port. */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

/**
 * Outbound port for password hashing. The domain never sees which algorithm
 * backs it; the infrastructure adapter uses Argon2id.
 */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}
