import type { CreateUserInput, User } from './user.js';

/** DI token for the {@link UserRepository} port. */
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

/** Outbound port for user persistence. Users are global, so no tenant scoping. */
export interface UserRepository {
  create(input: CreateUserInput): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  /**
   * The user plus its password hash, for credential verification. The hash
   * never leaves the application layer inside the domain `User`.
   */
  findByEmailWithPassword(email: string): Promise<UserCredentials | null>;
  setPassword(userId: string, passwordHash: string): Promise<User | null>;
  markEmailVerified(userId: string): Promise<void>;
}

export interface UserCredentials {
  readonly user: User;
  readonly passwordHash: string | null;
}
