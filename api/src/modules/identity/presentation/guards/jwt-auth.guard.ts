import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '../../../../shared/tenancy/tenant-context.service.js';
import { SessionValidator } from '../../application/session-validator.js';
import { extractBearerToken } from './extract-bearer.js';

/**
 * Authenticates tenant-scoped requests.
 *
 * Verifies the Bearer token and revalidates it against the database through
 * the shared {@link SessionValidator} (the same rules the WebSocket handshake
 * runs), then records the principal for the transaction interceptor and RLS.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionValidator,
    private readonly context: TenantContextService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException({
        message: 'A Bearer access token is required.',
        code: 'ACCESS_TOKEN_MISSING',
      });
    }

    const principal = await this.sessions.validate(token);
    this.context.set(principal);
    return true;
  }
}
