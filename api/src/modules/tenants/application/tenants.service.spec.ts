import { ConflictException, NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type {
  CreateTenantInput,
  Tenant,
  TenantPlan,
  TenantStatus,
  UpdateTenantInput,
} from '../domain/tenant.js';
import type { TenantRepository } from '../domain/tenant.repository.js';
import { TenantsService } from './tenants.service.js';

function timestamp(): Date {
  return new Date('2024-01-01T00:00:00.000Z');
}

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: '7f78b4a2-0000-4000-8000-000000000001',
    name: 'Acme Logistics',
    slug: 'acme-logistics',
    status: 'active',
    plan: 'free',
    settings: {},
    createdAt: timestamp(),
    updatedAt: timestamp(),
    ...overrides,
  };
}

class InMemoryTenantRepository implements TenantRepository {
  rows = new Map<string, Tenant>();

  async create(input: CreateTenantInput): Promise<Tenant> {
    const tenant = makeTenant({
      slug: input.slug,
      name: input.name,
      plan: (input.plan ?? 'free') as TenantPlan,
      settings: input.settings ?? {},
    });
    this.rows.set(tenant.id, tenant);
    return tenant;
  }

  async findById(id: string): Promise<Tenant | null> {
    return this.rows.get(id) ?? null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    return [...this.rows.values()].find((row) => row.slug === slug) ?? null;
  }

  async list(): Promise<Tenant[]> {
    return [...this.rows.values()];
  }

  async update(id: string, changes: UpdateTenantInput): Promise<Tenant | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...changes,
      status: (changes.status ?? existing.status) as TenantStatus,
      plan: (changes.plan ?? existing.plan) as TenantPlan,
    };
    this.rows.set(id, updated);
    return updated;
  }
}

describe('TenantsService', () => {
  const repository = new InMemoryTenantRepository();
  const service = new TenantsService(repository as TenantRepository);

  beforeEach(() => {
    repository.rows.clear();
  });

  it('creates a tenant with defaults', async () => {
    const tenant = await service.create({
      name: 'Acme Logistics',
      slug: 'acme-logistics',
    });

    expect(tenant).toMatchObject({
      name: 'Acme Logistics',
      slug: 'acme-logistics',
      status: 'active',
      plan: 'free',
    });
  });

  it('rejects a duplicate slug', async () => {
    await service.create({ name: 'Acme', slug: 'acme' });

    await expect(service.create({ name: 'Also Acme', slug: 'acme' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('maps a database unique violation to a 409 conflict', async () => {
    // The pre-check lost a race with a concurrent create; the database's
    // unique constraint is the backstop and must still surface as a 409.
    jest.spyOn(repository, 'create').mockRejectedValueOnce({
      driverError: { code: '23505' },
    });

    await expect(service.create({ name: 'Acme', slug: 'acme' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws a typed 404 for an unknown id on read', async () => {
    await expect(service.getById('missing')).rejects.toThrow(NotFoundException);
  });

  it('throws a typed 404 for an unknown id on update', async () => {
    await expect(service.update('missing', { name: 'x' })).rejects.toThrow(
      NotFoundException,
    );
  });
});