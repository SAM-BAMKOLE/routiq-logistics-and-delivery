import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { TENANT_CLS_KEY, type TenantPrincipal } from './tenant-context.js';

/**
 * Injects the active {@link TenantPrincipal} into a handler parameter.
 *
 * `createParamDecorator` runs outside Nest's DI container, so the CLS service
 * is resolved through its static accessor rather than injected.
 *
 * ```ts
 * @Get('shipments')
 * list(@CurrentTenant() tenant: TenantPrincipal) { ... }
 * ```
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, _context: ExecutionContext): TenantPrincipal | undefined => {
    const cls = ClsServiceManager.getClsService();
    return cls.get(TENANT_CLS_KEY) as TenantPrincipal | undefined;
  },
);
