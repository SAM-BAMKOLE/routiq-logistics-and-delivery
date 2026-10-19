import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { Repository } from 'typeorm';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import { DEFAULT_SURCHARGES } from '../domain/pricing-rule.js';
import type {
  CreatePricingRuleInput,
  PricingRule,
  UpdatePricingRuleInput,
} from '../domain/pricing-rule.js';
import type { PricingRuleRepository } from '../domain/pricing-rule.repository.js';
import { PricingRuleOrmEntity } from './pricing-rule.orm-entity.js';

/** TypeORM implementation of the {@link PricingRuleRepository} port. */
@Injectable()
export class TypeOrmPricingRuleRepository implements PricingRuleRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly tenants: TenantContextService,
  ) {}

  async create(
    tenantId: string,
    input: CreatePricingRuleInput,
  ): Promise<PricingRule> {
    const repository = this.repository();
    const entity = repository.create({
      tenantId,
      name: input.name,
      baseFeeMinor: input.baseFeeMinor ?? 0,
      perKmMinor: input.perKmMinor ?? 0,
      perKgMinor: input.perKgMinor ?? 0,
      minFeeMinor: input.minFeeMinor ?? 0,
      priority: input.priority ?? 0,
      activeFrom: input.activeFrom ?? new Date(),
      // A rate card with no catalogue still ships: it starts with the stock
      // surcharge list (express, terrain, handling) and the admin edits it.
      surcharges: [...(input.surcharges ?? DEFAULT_SURCHARGES)],
    });
    return toDomain(await repository.save(entity));
  }

  async findById(id: string): Promise<PricingRule | null> {
    const entity = await this.repository().findOne({
      where: { id, ...this.tenants.scope() },
    });
    return entity ? toDomain(entity) : null;
  }

  async listByTenant(tenantId: string): Promise<PricingRule[]> {
    const entities = await this.repository().find({
      where: { tenantId },
      order: { priority: 'DESC', createdAt: 'ASC' },
    });
    return entities.map(toDomain);
  }

  async update(
    id: string,
    changes: UpdatePricingRuleInput,
  ): Promise<PricingRule | null> {
    const repository = this.repository();
    const entity = await repository.findOne({
      where: { id, ...this.tenants.scope() },
    });
    if (!entity) {
      return null;
    }
    const { surcharges, ...rest } = changes;
    repository.merge(entity, {
      ...rest,
      // `merge` wants a mutable array; the input type is readonly.
      ...(surcharges ? { surcharges: [...surcharges] } : {}),
    });
    return toDomain(await repository.save(entity));
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.repository().delete({
      id,
      ...this.tenants.scope(),
    });
    return (result.affected ?? 0) > 0;
  }

  private repository(): Repository<PricingRuleOrmEntity> {
    return this.txHost.tx.getRepository(PricingRuleOrmEntity);
  }
}

function toDomain(entity: PricingRuleOrmEntity): PricingRule {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    baseFeeMinor: entity.baseFeeMinor,
    perKmMinor: entity.perKmMinor,
    perKgMinor: entity.perKgMinor,
    minFeeMinor: entity.minFeeMinor,
    priority: entity.priority,
    activeFrom: entity.activeFrom,
    surcharges: entity.surcharges ?? [],
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
