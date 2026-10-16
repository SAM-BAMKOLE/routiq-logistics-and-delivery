import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { Repository } from 'typeorm';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import type {
  CreateCustomerInput,
  Customer,
  UpdateCustomerInput,
} from '../domain/customer.js';
import type { CustomerRepository } from '../domain/customer.repository.js';
import { CustomerOrmEntity } from './customer.orm-entity.js';

/** TypeORM implementation of the {@link CustomerRepository} port. */
@Injectable()
export class TypeOrmCustomerRepository implements CustomerRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly tenants: TenantContextService,
  ) {}

  async create(
    input: CreateCustomerInput & { tenantId: string },
  ): Promise<Customer> {
    const repository = this.repository();
    const entity = repository.create({
      tenantId: input.tenantId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      userId: input.userId ?? null,
    });
    return toDomain(await repository.save(entity));
  }

  async findById(id: string): Promise<Customer | null> {
    const entity = await this.repository().findOne({
      where: { id, ...this.tenants.scope() },
    });
    return entity ? toDomain(entity) : null;
  }

  async listByTenant(tenantId: string): Promise<Customer[]> {
    const entities = await this.repository().find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
    return entities.map(toDomain);
  }

  async listByUserId(tenantId: string, userId: string): Promise<Customer[]> {
    const entities = await this.repository().find({
      where: { tenantId, userId },
      order: { createdAt: 'ASC' },
    });
    return entities.map(toDomain);
  }

  async update(
    id: string,
    changes: UpdateCustomerInput,
  ): Promise<Customer | null> {
    const repository = this.repository();
    const entity = await repository.findOne({
      where: { id, ...this.tenants.scope() },
    });
    if (!entity) {
      return null;
    }
    repository.merge(entity, changes);
    return toDomain(await repository.save(entity));
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.repository().delete({
      id,
      ...this.tenants.scope(),
    });
    return (result.affected ?? 0) > 0;
  }

  private repository(): Repository<CustomerOrmEntity> {
    return this.txHost.tx.getRepository(CustomerOrmEntity);
  }
}

function toDomain(entity: CustomerOrmEntity): Customer {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    email: entity.email,
    phone: entity.phone,
    userId: entity.userId,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
