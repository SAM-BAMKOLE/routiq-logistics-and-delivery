import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { TenantContextService } from './tenant-context.service.js';
import { TenantTransactionService } from './tenant-transaction.service.js';

/**
 * Wraps a tenant-scoped request in a single transaction.
 *
 * Guards run before interceptors, so by the time this runs the tenant is
 * already in the CLS context (set from the verified token). Requests with no
 * tenant — platform and public routes — pass through untouched.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly context: TenantContextService,
    private readonly transactions: TenantTransactionService,
  ) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.context.get()) {
      return next.handle();
    }

    // The handler runs inside the transaction: its queries share one
    // connection and the tenant setting is bound to it. The transaction
    // commits when the handler resolves and rolls back when it throws.
    return from(
      this.transactions.inTenantTransaction(() => lastValueFrom(next.handle())),
    );
  }
}
