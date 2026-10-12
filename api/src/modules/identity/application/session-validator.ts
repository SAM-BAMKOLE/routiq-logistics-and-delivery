import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { TenantPrincipal } from '../../../shared/tenancy/tenant-context.js';
import { TenantTransactionService } from '../../../shared/tenancy/tenant-transaction.service.js';
import type { AccessTokenIssuer } from './access-tokens.js';
import { ACCESS_TOKEN_ISSUER } from './access-tokens.js';
import type { MembershipRepository } from '../domain/membership.repository.js';
import { MEMBERSHIP_REPOSITORY } from '../domain/membership.repository.js';
import type { UserRepository } from '../domain/user.repository.js';
import { USER_REPOSITORY } from '../domain/user.repository.js';

/**
 * Turns a Bearer access token into a trusted {@link TenantPrincipal}.
 *
 * The shared core of every transport that authenticates a caller: the HTTP
 * {@link JwtAuthGuard} runs it per request, and the Socket.IO gateway runs it
 * on handshake. One implementation, one set of rules — the token is a hint,
 * the database decides: the user must be active, the membership must be
 * active, and the tenant must not be suspended. The tenant always comes from
 * the verified token, so nothing a client sends can move it to another
 * tenant.
 *
 * Failures are `HttpException`s (401 for a bad token, 403 for a session that
 * exists but may not act) because over HTTP they surface as problem+json;
 * the WebSocket handshake catches them and reports the code to the client.
 */
@Injectable()
export class SessionValidator {
  constructor(
    @Inject(ACCESS_TOKEN_ISSUER)
    private readonly accessTokens: AccessTokenIssuer,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly memberships: MembershipRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly transactions: TenantTransactionService,
  ) {}

  async validate(token: string): Promise<TenantPrincipal> {
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
    const membership = await this.transactions.runWithTenant(
      tid,
      async (manager) => {
        const user = await this.users.findById(sub);
        if (!user || user.status !== 'active') {
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
      },
    );

    return {
      tenantId: tid,
      userId: sub,
      role: membership.role,
      isPlatformAdmin: adm,
    };
  }
}
