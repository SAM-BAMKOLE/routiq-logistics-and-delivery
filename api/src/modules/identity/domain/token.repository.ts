/** DI token for the {@link RefreshTokenStore} port. */
export const REFRESH_TOKEN_STORE = Symbol('REFRESH_TOKEN_STORE');

/** DI token for the {@link OneTimeTokenStore} port. */
export const ONE_TIME_TOKEN_STORE = Symbol('ONE_TIME_TOKEN_STORE');

/** Purposes for single-use tokens. Invite ships now; verify/reset follow with email. */
export const TOKEN_PURPOSES = ['invite'] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

export interface RefreshToken {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string | null;
  readonly familyId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedBy: string | null;
  readonly createdAt: Date;
}

export interface CreateRefreshTokenInput {
  userId: string;
  tenantId: string | null;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface OneTimeToken {
  readonly id: string;
  readonly userId: string;
  readonly purpose: TokenPurpose;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly metadata: Record<string, unknown>;
}

export interface CreateOneTimeTokenInput {
  userId: string;
  purpose: TokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Outbound port for opaque refresh tokens. Tokens are looked up by hash only;
 * the raw value never touches the database.
 */
export interface RefreshTokenStore {
  create(input: CreateRefreshTokenInput): Promise<RefreshToken>;
  findByHash(tokenHash: string): Promise<RefreshToken | null>;
  revoke(id: string, replacedBy: string | null): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
}

/** Outbound port for single-use tokens (invitations now, verify/reset later). */
export interface OneTimeTokenStore {
  create(input: CreateOneTimeTokenInput): Promise<OneTimeToken>;
  findByHash(tokenHash: string): Promise<OneTimeToken | null>;
  markUsed(id: string): Promise<void>;
}
