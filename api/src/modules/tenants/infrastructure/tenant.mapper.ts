import type { Tenant, TenantPlan, TenantStatus } from '../domain/tenant.js';
import type { TenantOrmEntity } from './tenant.orm-entity.js';

/**
 * Maps between the persistence entity and the domain model, so the domain
 * never sees TypeORM types. Status and plan arrive as free text from the
 * database and are narrowed to their unions here.
 */
export const TenantMapper = {
  toDomain(entity: TenantOrmEntity): Tenant {
    return {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      status: entity.status as TenantStatus,
      plan: entity.plan as TenantPlan,
      settings: entity.settings,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  },
};
