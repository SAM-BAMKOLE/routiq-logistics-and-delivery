/** DI token for the {@link AccessTokenIssuer} port. */
export const ACCESS_TOKEN_ISSUER = Symbol('ACCESS_TOKEN_ISSUER');

/**
 * Claims carried by the short-lived access token: the user (`sub`), the
 * active tenant (`tid`, null for platform-only sessions), the tenant role,
 * and the platform-admin flag (`adm`). Guards treat the claims as a hint and
 * revalidate membership and tenant status against the database.
 */
export interface AccessTokenClaims {
  sub: string;
  tid: string | null;
  role: string | null;
  adm: boolean;
  type: 'access';
}

/** Outbound port for access-token signing and verification. */
export interface AccessTokenIssuer {
  sign(claims: Omit<AccessTokenClaims, 'type'>): Promise<string>;
  verify(token: string): Promise<AccessTokenClaims>;
}

/**
 * Parses a TTL like `15m`, `3600s`, `2h`, or `7d` into seconds. Falls back
 * when the value is malformed, so a typo degrades to a safe default instead
 * of a crash — validation still rejects boot on missing secrets.
 */
export function parseTtlToSeconds(ttl: string, fallbackSeconds: number): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(ttl.trim());
  if (!match) {
    return fallbackSeconds;
  }
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(match[1]) * multipliers[match[2]];
}
