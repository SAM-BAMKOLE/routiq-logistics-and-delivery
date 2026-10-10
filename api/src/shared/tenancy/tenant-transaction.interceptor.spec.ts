import { lastValueFrom, of } from 'rxjs';
import { jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import type { TenantPrincipal } from './tenant-context.js';
import type { TenantContextService } from './tenant-context.service.js';
import type { TenantTransactionService } from './tenant-transaction.service.js';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor.js';

describe('TenantTransactionInterceptor', () => {
  const principal: TenantPrincipal = {
    tenantId: 't-1',
    userId: 'u-1',
    role: 'dispatcher',
  };

  function contextFor(_tenant: TenantPrincipal | undefined): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getClass: () => class {},
      getHandler: () => ({}),
    } as unknown as ExecutionContext;
  }

  function makeInterceptor(get: () => TenantPrincipal | undefined) {
    const context = { get } as TenantContextService;
    const inTenantTransaction = jest.fn(
      async (fn: () => Promise<unknown>) => fn(),
    );
    const interceptor = new TenantTransactionInterceptor(context, {
      inTenantTransaction,
    } as unknown as TenantTransactionService);
    return { interceptor, inTenantTransaction };
  }

  it('passes the request through untouched when no tenant is active', async () => {
    const { interceptor, inTenantTransaction } = makeInterceptor(() => undefined);

    const result = await lastValueFrom(
      interceptor.intercept(contextFor(undefined), {
        handle: () => of('ok'),
      }),
    );

    expect(result).toBe('ok');
    expect(inTenantTransaction).not.toHaveBeenCalled();
  });

  it('runs the handler inside a tenant transaction when a tenant is active', async () => {
    const { interceptor, inTenantTransaction } = makeInterceptor(() => principal);

    const result = await lastValueFrom(
      interceptor.intercept(contextFor(principal), {
        handle: () => of('ok'),
      }),
    );

    expect(result).toBe('ok');
    expect(inTenantTransaction).toHaveBeenCalledTimes(1);
  });
});