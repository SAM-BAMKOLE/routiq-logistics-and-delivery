import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ClsModule } from 'nestjs-cls';
import { TenantContextService } from './tenant-context.service.js';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor.js';
import { TenantTransactionService } from './tenant-transaction.service.js';

/**
 * The tenancy kernel: request-scoped tenant context plus the transactional
 * boundary that binds `app.tenant_id` to every tenant-scoped query.
 *
 * It is global so feature modules can inject the context and the transaction
 * host without importing it. The `ClsPluginTransactional` adapter wires
 * `@nestjs-cls/transactional` to the application's TypeORM `DataSource`.
 */
@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      // Mounts the AsyncLocalStorage middleware on every route, so a context
      // exists before guards and interceptors run.
      middleware: { mount: true },
      plugins: [
        new ClsPluginTransactional({
          adapter: new TransactionalAdapterTypeOrm({
            dataSourceToken: getDataSourceToken(),
          }),
        }),
      ],
    }),
  ],
  providers: [
    TenantContextService,
    TenantTransactionService,
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
  ],
  exports: [TenantContextService, TenantTransactionService],
})
export class TenancyModule {}
