import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantsService } from './application/tenants.service.js';
import { TENANT_REPOSITORY } from './domain/tenant.repository.js';
import { TenantOrmEntity } from './infrastructure/tenant.orm-entity.js';
import { TypeOrmTenantRepository } from './infrastructure/typeorm-tenant.repository.js';
import { PlatformAdminGuard } from './presentation/platform-admin.guard.js';
import { PlatformTenantsController } from './presentation/platform-tenants.controller.js';

/**
 * Tenant registry module: the global `tenants` table and the platform API that
 * manages it. The repository port is bound to its TypeORM implementation here,
 * so the application layer stays persistence-agnostic.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TenantOrmEntity])],
  controllers: [PlatformTenantsController],
  providers: [
    TenantsService,
    PlatformAdminGuard,
    { provide: TENANT_REPOSITORY, useClass: TypeOrmTenantRepository },
  ],
  exports: [TenantsService],
})
export class TenantsModule {}
