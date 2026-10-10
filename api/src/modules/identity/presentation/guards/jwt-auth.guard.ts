import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantContextService } from '../../../../shared/tenancy/tenant-context.service.js';
import { TenantTransactionService } from '../../../../shared/tenancy/tenant-transaction.service.js';
import type {
  AccessTokenIssuer,
} from '../../application/access-tokens.js';
import { ACCESS_TOKEN_ISSUER } from '../../application/access-tokens.js';
import type { MembershipRepository } from '../../domain/membership.repository.js';
import { MEMBERSHIP_REPOSITORY } from '../../domain/membership.repository.js';
import type { UserRepository } from '../../domain/user.repository.js';
import { USER_REPOSITORY } from '../../domain/user.repository.js';
import { extractBearerToken } from './extract-bearer.js';

/**
 * Authenticates tenant-scoped requests.
 *
 * It verifies the Bearer access token, then revalidates against the database —
 * the token is a hint, the database decides: the user must be active, the
 * membership must be active, and the tenant must not be suspended. The tenant
 * always comes from the verified token, so the resulting principal feeds the
 * transaction interceptor and RLS.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_ISSUER)
    private readonly accessTokens: AccessTokenIssuer,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly memberships: MembershipRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly transactions: TenantTransactionService,
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

    let sub: string;
    let tid: string | null;
    let adm: boolean;
    try {
      const claims = await this.accessTokens.verify(token);
      sub = claims.sub;
      tid = claims.tid;
      adm = claims.adm;
    } catch {
      throw new UnauthorizedException({
        message: 'The access token is invalid or expired.',
        code: 'ACCESS_TOKEN_INVALID',
      });
    }

    if (!tid) {
      // Platform-only sessions carry no tenant and cannot enter tenant routes.
      throw new ForbiddenException({
        message: 'This route requires a tenant-scoped session.',
        code: 'TENANT_CONTEXT_REQUIRED',
      });
    }

    // Validation runs in its own read-only tenant transaction: the guard runs
    // before the interceptor, so the request transaction does not exist yet.
    const membership = await this.transactions.runWithTenant(tid, async (manager) => {
      const users = await this.users.findById(sub);
      if (!users || users.status !== 'active') {
        throw new ForbiddenException({
          message: 'This user is suspended.',
          code: 'USER_SUSPENDED',
        });
      }
      const [tenantRow] = (await manager.query(
        `SELECT status FROM tenants WHERE id = $1`,
        [tid],
      )) as Array<{ status: string }>;
      if (!tenantRow || tenantRow.status !== 'active') {
        throw new ForbiddenException({
          message: 'This tenant is suspended.',
          code: 'TENANT_SUSPENDED',
        });
      }
      const entry = await this.memberships.findByTenantAndUser(tid, sub);
      if (!entry || entry.status !== 'active') {
        throw new ForbiddenException({
          message: 'There is no active membership for this tenant.',
          code: 'MEMBERSHIP_INACTIVE',
        });
      }
      return entry;
    });

    this.context.set({
      tenantId: tid,
      userId: sub,
      role: membership.role,
      isPlatformAdmin: adm,
    });
    return true;
  }
}
