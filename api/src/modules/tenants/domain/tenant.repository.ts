import type { CreateTenantInput, Tenant, UpdateTenantInput } from './tenant.js';

/** DI token for the {@link TenantRepository} port. */
export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');

/**
 * Outbound port for tenant persistence. The application layer depends on this
 * interface, never on TypeORM.
 */
export interface TenantRepository {
  create(input: CreateTenantInput): Promise<Tenant>;
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
  update(id: string, changes: UpdateTenantInput): Promise<Tenant | null>;
}
