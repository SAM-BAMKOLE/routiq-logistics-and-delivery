import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  TENANT_CLS_KEY,
  type LdmsClsStore,
  type TenantPrincipal,
} from './tenant-context.js';

/**
 * Request-scoped tenant context, backed by `AsyncLocalStorage` through
 * `nestjs-cls`.
 *
 * Guards populate it from the verified token; the transaction interceptor and
 * repositories read it. Everything downstream of the guard sees the same
 * principal without threading it through method signatures.
 */
@Injectable()
export class TenantContextService {
  constructor(private readonly cls: ClsService<LdmsClsStore>) {}

  /** Records the active principal for the current context. */
  set(principal: TenantPrincipal): void {
    this.cls.set(TENANT_CLS_KEY, principal);
  }

  /** The active principal, or `undefined` outside a tenant-scoped context. */
  get(): TenantPrincipal | undefined {
    return this.cls.get(TENANT_CLS_KEY);
  }

  /**
   * Whether a CLS context is active. Routes excluded from the CLS middleware
   * (health probes, metrics) run without one, and touching the store there
   * throws.
   */
  isActive(): boolean {
    return this.cls.isActive();
  }

  /** Records the request's correlation id for domain events to pick up. */
  setRequestId(requestId: string): void {
    this.cls.set('requestId', requestId);
  }

  getTenantId(): string | undefined {
    return this.get()?.tenantId;
  }

  /**
   * The active tenant, for code that cannot run without one. Throwing here is a
   * programming error, not a client error: the guard is expected to have run.
   */
  requireTenantId(): string {
    const tenantId = this.getTenantId();
    if (!tenantId) {
      throw new Error(
        'No tenant context is active. Tenant-scoped work must run after a ' +
          'guard has established the principal.',
      );
    }
    return tenantId;
  }

  /**
   * A TypeORM `where` fragment that scopes a query to the active tenant.
   *
   * Spread it into a `where` object: `{ id, ...this.tenants.scope() }`. When no
   * tenant is active — login, platform routes, bootstrap — it returns an empty
   * object, so the query runs unfiltered by design rather than throwing. Every
   * repository that touches a tenant-scoped table must use this (or an
   * explicit `tenantId`) so tenant isolation never depends on the caller.
   */
  scope(): { tenantId?: string } {
    const tenantId = this.getTenantId();
    return tenantId === undefined ? {} : { tenantId };
  }

  /**
   * Runs `fn` with a freshly established principal. Used by background jobs
   * (whose payload carries the tenant) and by tests, which have no request to
   * populate the context.
   */
  runWith<T>(principal: TenantPrincipal, fn: () => T): T {
    return this.cls.runWith({ tenant: principal } as LdmsClsStore, fn);
  }
}
