import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { EntityManager } from 'typeorm';
import { TenantContextService } from './tenant-context.service.js';

/**
 * The single place a tenant transaction is opened.
 *
 * It wraps each tenant-scoped request in one transaction, so a request's writes
 * commit or roll back together. `nestjs-cls` + `@nestjs-cls/transactional` keep
 * the transaction's `EntityManager` in the CLS store, so repositories get it for
 * free: they ask the `TransactionHost` for `tx` and never touch the pooled
 * manager directly. Tenant isolation itself is applied by the repositories,
 * which filter every query by the active tenant.
 */
@Injectable()
export class TenantTransactionService {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly context: TenantContextService,
  ) {}

  /** The manager bound to the current transaction (or the pooled fallback). */
  get manager(): EntityManager {
    return this.txHost.tx;
  }

  /**
   * Runs `fn` inside one transaction scoped to the tenant currently in context.
   * The request pipeline uses this through the interceptor.
   */
  inTenantTransaction<T>(
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    // Fail fast if a tenant-scoped route reaches here with no principal:
    // repositories scope their queries to the active tenant, so an empty
    // context must never silently run a cross-tenant transaction.
    this.context.requireTenantId();
    return this.txHost.withTransaction(async () => fn(this.txHost.tx));
  }

  /**
   * Establishes a fresh tenant context (for background jobs whose payload
   * carries the tenant, and for tests) and runs `fn` in a tenant transaction.
   */
  runWithTenant<T>(
    tenantId: string,
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.context.runWith(
      { tenantId, userId: '', role: 'system', isPlatformAdmin: false },
      () => this.inTenantTransaction(fn),
    );
  }
}
