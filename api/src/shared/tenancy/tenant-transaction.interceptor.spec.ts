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
    isPlatformAdmin: false,
  };

  function contextFor(
    _tenant: TenantPrincipal | undefined,
    headers: Record<string, string> = {},
  ): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
      getClass: () => class {},
      getHandler: () => ({}),
    } as unknown as ExecutionContext;
  }

  function makeInterceptor(
    get: () => TenantPrincipal | undefined,
    isActive = true,
  ) {
    const setRequestId = jest.fn();
    const context = { get, setRequestId, isActive: () => isActive } as unknown as TenantContextService;
    const inTenantTransaction = jest.fn(
      async (fn: () => Promise<unknown>) => fn(),
    );
    const interceptor = new TenantTransactionInterceptor(context, {
      inTenantTransaction,
    } as unknown as TenantTransactionService);
    return { interceptor, inTenantTransaction, setRequestId };
  }

  it('passes the request through untouched when no tenant is active', async () => {
    const { interceptor, inTenantTransaction, setRequestId } = makeInterceptor(
      () => undefined,
    );

    const result = await lastValueFrom(
      interceptor.intercept(contextFor(undefined), {
        handle: () => of('ok'),
      }),
    );

    expect(result).toBe('ok');
    expect(inTenantTransaction).not.toHaveBeenCalled();
    // The correlation id is captured even without a transaction: global
    // events (password reset) carry it too.
    expect(setRequestId).toHaveBeenCalledTimes(1);
    expect(setRequestId).toHaveBeenCalledWith(expect.any(String));
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

  it('reuses an inbound x-request-id as the correlation id', async () => {
    const { interceptor, setRequestId } = makeInterceptor(() => principal);

    await lastValueFrom(
      interceptor.intercept(contextFor(principal, { 'x-request-id': 'abc-123' }), {
        handle: () => of('ok'),
      }),
    );

    expect(setRequestId).toHaveBeenCalledWith('abc-123');
  });

  it('skips everything on routes that opted out of the CLS middleware', async () => {
    // Health probes and metrics run with no CLS context: touching the store
    // there throws, so the interceptor must not go near it.
    const { interceptor, inTenantTransaction, setRequestId } = makeInterceptor(
      () => principal,
      false,
    );

    const result = await lastValueFrom(
      interceptor.intercept(contextFor(principal), {
        handle: () => of('ok'),
      }),
    );

    expect(result).toBe('ok');
    expect(setRequestId).not.toHaveBeenCalled();
    expect(inTenantTransaction).not.toHaveBeenCalled();
  });
});