import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { AccessTokenIssuer } from '../../application/access-tokens.js';
import { SessionValidator } from '../../application/session-validator.js';
import type { MembershipRepository } from '../../domain/membership.repository.js';
import type { UserRepository } from '../../domain/user.repository.js';
import type { TenantContextService } from '../../../../shared/tenancy/tenant-context.service.js';
import type { TenantTransactionService } from '../../../../shared/tenancy/tenant-transaction.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

function requestWith(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader ? { authorization: authHeader } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

interface Harness {
  guard: JwtAuthGuard;
  principal: { tenantId: string; userId: string; role: string; isPlatformAdmin: boolean } | null;
}

function makeHarness(options?: {
  tenantStatus?: string;
  membership?: { role: string; status: string } | null;
  userStatus?: string;
}): Harness {
  const issuer: AccessTokenIssuer = {
    sign: async () => 'token',
    verify: async (token: string) => {
      if (token !== 'valid') {
        throw new Error('bad token');
      }
      return { sub: 'u-1', tid: 't-1', role: 'dispatcher', adm: false, type: 'access' as const };
    },
  };
  const memberships = {
    findByTenantAndUser: async () =>
      options?.membership === null
        ? null
        : {
            id: 'm-1',
            tenantId: 't-1',
            userId: 'u-1',
            role: options?.membership?.role ?? 'dispatcher',
            status: options?.membership?.status ?? 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
  } as unknown as MembershipRepository;
  const users = {
    findById: async () => ({
      id: 'u-1',
      email: 'a@example.com',
      name: null,
      isPlatformAdmin: false,
      emailVerifiedAt: null,
      status: options?.userStatus ?? 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      hasPassword: true,
    }),
  } as unknown as UserRepository;
  const transactions = {
    runWithTenant: async <T>(
      _tenantId: string,
      fn: (manager: { query: () => Promise<Array<{ status: string }>> }) => Promise<T>,
    ): Promise<T> =>
      fn({
        query: async () => [{ status: options?.tenantStatus ?? 'active' }],
      }),
  } as unknown as TenantTransactionService;

  let principal: Harness['principal'] = null;
  const context = {
    set: (value: NonNullable<Harness['principal']>) => {
      principal = value;
    },
  } as unknown as TenantContextService;

  return {
    guard: new JwtAuthGuard(
      new SessionValidator(issuer, memberships, users, transactions),
      context,
    ),
    get principal() {
      return principal;
    },
  };
}

describe('JwtAuthGuard', () => {
  it('sets the principal from a valid token after database validation', async () => {
    const h = makeHarness();

    await expect(h.guard.canActivate(requestWith('Bearer valid'))).resolves.toBe(true);
    expect(h.principal).toEqual({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'dispatcher',
      isPlatformAdmin: false,
    });
  });

  it('rejects missing and invalid tokens with 401', async () => {
    const h = makeHarness();

    await expect(h.guard.canActivate(requestWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      h.guard.canActivate(requestWith('Bearer bogus')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      h.guard.canActivate(requestWith('Basic abc')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects suspended tenants, inactive memberships, and suspended users', async () => {
    await expect(
      makeHarness({ tenantStatus: 'suspended' }).guard.canActivate(
        requestWith('Bearer valid'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      makeHarness({ membership: { role: 'dispatcher', status: 'suspended' } }).guard.canActivate(
        requestWith('Bearer valid'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      makeHarness({ membership: null }).guard.canActivate(requestWith('Bearer valid')),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      makeHarness({ userStatus: 'suspended' }).guard.canActivate(
        requestWith('Bearer valid'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
