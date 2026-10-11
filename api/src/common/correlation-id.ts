import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

/**
 * The id that ties a request, its log lines, and its domain events together.
 *
 * Reuses the caller's `x-request-id` when present so a client can follow its
 * own request through the system; otherwise falls back to the id pino
 * assigned (and only then generates one, for requests that bypassed the
 * logger). Shared by the exception filter's `correlationId` and the CLS
 * capture that events read.
 */
export function resolveCorrelationId(request: Request): string {
  const header = request.headers['x-request-id'];
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  return (request as Request & { id?: string }).id ?? randomUUID();
}
