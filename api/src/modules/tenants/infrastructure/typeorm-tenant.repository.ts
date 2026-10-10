import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { Repository } from 'typeorm';
import type {
  CreateTenantInput,
  Tenant,
  UpdateTenantInput,
} from '../domain/tenant.js';
import type { TenantRepository } from '../domain/tenant.repository.js';
import { TenantMapper } from './tenant.mapper.js';
import { TenantOrmEntity } from './tenant.orm-entity.js';

/**
 * TypeORM implementation of the {@link TenantRepository} port.
 *
 * It resolves its repository from the `TransactionHost`, not from an injected
 * `Repository`, so when a tenant transaction is active the query joins it and
 * otherwise falls back to the pooled manager. The tenants table is global, but
 * going through the host keeps the pattern uniform across every repository.
 */
@Injectable()
export class TypeOrmTenantRepository implements TenantRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async create(input: CreateTenantInput): Promise<Tenant> {
    const repository = this.repository();
    const entity = repository.create({
      name: input.name,
      slug: input.slug,
      plan: input.plan ?? 'free',
      settings: input.settings ?? {},
    });
    return TenantMapper.toDomain(await repository.save(entity));
  }

  async findById(id: string): Promise<Tenant | null> {
    const entity = await this.repository().findOne({ where: { id } });
    return entity ? TenantMapper.toDomain(entity) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const entity = await this.repository().findOne({ where: { slug } });
    return entity ? TenantMapper.toDomain(entity) : null;
  }

  async list(): Promise<Tenant[]> {
    const entities = await this.repository().find({
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => TenantMapper.toDomain(entity));
  }

  async update(id: string, changes: UpdateTenantInput): Promise<Tenant | null> {
    const repository = this.repository();
    const entity = await repository.findOne({ where: { id } });
    if (!entity) {
      return null;
    }
    repository.merge(entity, changes);
    return TenantMapper.toDomain(await repository.save(entity));
  }

  private repository(): Repository<TenantOrmEntity> {
    return this.txHost.tx.getRepository(TenantOrmEntity);
  }
}
