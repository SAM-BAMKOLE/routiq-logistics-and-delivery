import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { resolveCorrelationId } from '../../common/correlation-id.js';
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

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Health probes and other routes excluded from the CLS middleware run
    // with no context at all: nothing to correlate, nothing to open.
    if (!this.context.isActive()) {
      return next.handle();
    }

    // Captured before the tenant check: global events (password reset) carry
    // a correlation id too, even though no transaction opens for them.
    const request = context.switchToHttp().getRequest<Request>();
    this.context.setRequestId(resolveCorrelationId(request));

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
