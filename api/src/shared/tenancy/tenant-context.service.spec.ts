import { AsyncLocalStorage } from 'node:async_hooks';
import { ClsService } from 'nestjs-cls';
import { TenantContextService } from './tenant-context.service.js';

describe('TenantContextService', () => {
  const cls = new ClsService<{
    tenant?:
      | {
          tenantId: string;
          userId: string;
          role: string;
          isPlatformAdmin: boolean;
        }
      | undefined;
  }>(new AsyncLocalStorage());
  const service = new TenantContextService(cls);

  const principal = {
    tenantId: 't-1',
    userId: 'u-1',
    role: 'dispatcher',
    isPlatformAdmin: false,
  };

  afterEach(() => {
    // Ensure no context leaks between tests.
    cls.exit(() => undefined);
  });

  it('stores and returns the principal in an active context', () => {
    const seen = cls.run(() => {
      service.set(principal);
      return service.get();
    });

    expect(seen).toEqual(principal);
    expect(service.getTenantId()).toBeUndefined();
  });

  it('is empty when no tenant is active', () => {
    expect(service.get()).toBeUndefined();
    expect(() => service.requireTenantId()).toThrow(/no tenant context/i);
  });

  it('runWith scopes the principal to the callback', () => {
    const inside = service.runWith(principal, () => service.getTenantId());
    expect(inside).toBe('t-1');
    // Outside the callback the context is gone.
    expect(service.getTenantId()).toBeUndefined();
  });
});