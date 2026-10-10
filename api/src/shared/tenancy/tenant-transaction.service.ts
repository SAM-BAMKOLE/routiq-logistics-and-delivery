import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { EntityManager } from 'typeorm';
import { TenantContextService } from './tenant-context.service.js';

/**
 * The single place a tenant transaction is opened.
 *
 * A transaction is what makes `SET LOCAL app.tenant_id` safe: the setting is
 * bound to the transaction, so a pooled connection goes back to the pool
 * clean and the next request cannot inherit it. Every query inside runs as the
 * restricted `ldms_app` role under the tenant's RLS policy.
 *
 * `nestjs-cls` + `@nestjs-cls/transactional` keep the transaction's
 * `EntityManager` in the CLS store, so repositories get it for free: they ask
 * the `TransactionHost` for `tx` and never touch the pooled manager directly.
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
    const tenantId = this.context.requireTenantId();
    return this.txHost.withTransaction(async () => {
      await this.applyTenantSetting(tenantId);
      return fn(this.txHost.tx);
    });
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

  /**
   * Binds the tenant to the open transaction. `true` makes it
   * transaction-local — the bind-parameter form of `SET LOCAL` — so it can
   * never outlive the transaction.
   */
  private async applyTenantSetting(tenantId: string): Promise<void> {
    await this.txHost.tx.query(
      `SELECT set_config('app.tenant_id', $1, true)`,
      [tenantId],
    );
  }
}
