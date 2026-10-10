import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module.js';
import { TenantsService } from './application/tenants.service.js';
import { TENANT_REPOSITORY } from './domain/tenant.repository.js';
import { TenantOrmEntity } from './infrastructure/tenant.orm-entity.js';
import { TypeOrmTenantRepository } from './infrastructure/typeorm-tenant.repository.js';
import { PlatformTenantsController } from './presentation/platform-tenants.controller.js';

/**
 * Tenant registry module: the global `tenants` table and the platform API that
 * manages it. Platform authorization comes from the identity module's
 * JWT-based guard (imported, not re-provided); the repository port is bound
 * to TypeORM here.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TenantOrmEntity]), IdentityModule],
  controllers: [PlatformTenantsController],
  providers: [
    TenantsService,
    { provide: TENANT_REPOSITORY, useClass: TypeOrmTenantRepository },
  ],
  exports: [TenantsService],
})
export class TenantsModule {}
