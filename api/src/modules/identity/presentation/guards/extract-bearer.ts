import type { Request } from 'express';

/**
 * Extracts the opaque value of an `Authorization: Bearer <token>` header.
 * Returns `null` for missing, malformed, or non-bearer schemes — callers map
 * every shape to the same 401, so nothing about the failure leaks.
 */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return null;
  }
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    return null;
  }
  return value;
}
