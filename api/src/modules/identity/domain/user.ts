/**
 * A person in domain terms: global, not tenant-scoped. Which tenants they can
 * act in is expressed by {@link Membership}, so one user may hold different
 * roles in different tenants. Persistence mapping lives in infrastructure.
 */
export const USER_STATUSES = ['active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly isPlatformAdmin: boolean;
  readonly emailVerifiedAt: Date | null;
  readonly status: UserStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Whether a password has been set (invited users have none until acceptance). */
  readonly hasPassword: boolean;
}

export interface CreateUserInput {
  email: string;
  name?: string | null;
  passwordHash?: string | null;
  isPlatformAdmin?: boolean;
}
