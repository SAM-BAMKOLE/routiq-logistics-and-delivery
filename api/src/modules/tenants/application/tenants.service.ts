import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateTenantInput,
  Tenant,
  UpdateTenantInput,
} from '../domain/tenant.js';
import {
  TENANT_REPOSITORY,
  type TenantRepository,
} from '../domain/tenant.repository.js';

/**
 * Application service for the tenant registry. It owns the business rules
 * (slugs are unique, a missing tenant is a 404) and knows nothing about HTTP.
 *
 * Platform tenants live outside any tenant transaction — they are the registry
 * itself — so these operations run on the pooled connection.
 */
@Injectable()
export class TenantsService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
  ) {}

  async create(input: CreateTenantInput): Promise<Tenant> {
    if (await this.tenants.findBySlug(input.slug)) {
      throw slugTaken(input.slug);
    }

    try {
      return await this.tenants.create(input);
    } catch (error) {
      // The pre-check above can lose a race with a concurrent create; the
      // database's unique constraint is the backstop.
      if (isUniqueViolation(error)) {
        throw slugTaken(input.slug);
      }
      throw error;
    }
  }

  list(): Promise<Tenant[]> {
    return this.tenants.list();
  }

  async getById(id: string): Promise<Tenant> {
    const tenant = await this.tenants.findById(id);
    if (!tenant) {
      throw tenantNotFound(id);
    }
    return tenant;
  }

  async update(id: string, changes: UpdateTenantInput): Promise<Tenant> {
    const tenant = await this.tenants.update(id, changes);
    if (!tenant) {
      throw tenantNotFound(id);
    }
    return tenant;
  }
}

function slugTaken(slug: string): ConflictException {
  return new ConflictException({
    message: `A tenant with slug "${slug}" already exists.`,
    code: 'TENANT_SLUG_TAKEN',
  });
}

function tenantNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Tenant ${id} was not found.`,
    code: 'TENANT_NOT_FOUND',
  });
}

/** Postgres unique-violation. TypeORM surfaces the driver error on `driverError`. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const driverError = (error as { driverError?: { code?: string } }).driverError;
  return driverError?.code === '23505';
}
