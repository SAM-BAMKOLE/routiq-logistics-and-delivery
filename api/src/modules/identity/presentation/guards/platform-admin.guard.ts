import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenIssuer } from '../../application/access-tokens.js';
import { ACCESS_TOKEN_ISSUER } from '../../application/access-tokens.js';
import { extractBearerToken } from './extract-bearer.js';

/**
 * Guards the platform administration API.
 *
 * Platform admin is a flag on the user (`adm` claim), not a tenant role. The
 * guard deliberately sets no tenant context: with nothing set, RLS returns no
 * tenant data by design, so a platform session cannot read tenant rows even
 * if a handler forgets to check.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_ISSUER)
    private readonly accessTokens: AccessTokenIssuer,
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

    let adm: boolean;
    try {
      adm = (await this.accessTokens.verify(token)).adm;
    } catch {
      throw new UnauthorizedException({
        message: 'The access token is invalid or expired.',
        code: 'ACCESS_TOKEN_INVALID',
      });
    }

    if (!adm) {
      throw new ForbiddenException({
        message: 'Platform administration requires a platform admin.',
        code: 'PLATFORM_ADMIN_REQUIRED',
      });
    }
    return true;
  }
}
