import {
  ForbiddenException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TenantPrincipal } from '../../../../shared/tenancy/tenant-context.js';
import type { TenantContextService } from '../../../../shared/tenancy/tenant-context.service.js';
import { PermissionsGuard } from './permissions.guard.js';

function emptyContext(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function guardWith(principal: TenantPrincipal | undefined, required: string[]): PermissionsGuard {
  const reflector = {
    getAllAndOverride: () => required,
  } as unknown as Reflector;
  const context = {
    get: () => principal,
  } as unknown as TenantContextService;
  return new PermissionsGuard(reflector, context);
}

describe('PermissionsGuard', () => {
  it('passes routes with no required permissions', () => {
    const guard = guardWith(undefined, []);
    expect(guard.canActivate(emptyContext())).toBe(true);
  });

  it('admits a tenant admin for any permission', () => {
    const guard = guardWith(
      { tenantId: 't-1', userId: 'u-1', role: 'tenant_admin', isPlatformAdmin: false },
      ['users:invite'],
    );
    expect(guard.canActivate(emptyContext())).toBe(true);
  });

  it('denies a dispatcher user administration with a stable code', () => {
    const guard = guardWith(
      { tenantId: 't-1', userId: 'u-1', role: 'dispatcher', isPlatformAdmin: false },
      ['users:invite'],
    );
    const error = (() => {
      try {
        guard.canActivate(emptyContext());
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('admits a role holding any one of several permissions', () => {
    const guard = guardWith(
      { tenantId: 't-1', userId: 'u-1', role: 'dispatcher', isPlatformAdmin: false },
      ['shipments:read-own', 'shipments:read'],
    );
    expect(guard.canActivate(emptyContext())).toBe(true);
  });

  it('denies a role holding none of several permissions', () => {
    const guard = guardWith(
      { tenantId: 't-1', userId: 'u-1', role: 'dispatcher', isPlatformAdmin: false },
      ['users:invite', 'pricing:manage'],
    );
    expect(() => guard.canActivate(emptyContext())).toThrow(ForbiddenException);
  });

  it('denies requests with no tenant principal', () => {
    const guard = guardWith(undefined, ['users:read']);
    expect(() =>
      guard.canActivate(emptyContext()),
    ).toThrow(ForbiddenException);
  });
});
