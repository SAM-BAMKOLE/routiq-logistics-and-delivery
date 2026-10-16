import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { Repository } from 'typeorm';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import type {
  CreateVehicleInput,
  UpdateVehicleInput,
  Vehicle,
  VehicleStatus,
  VehicleType,
} from '../domain/vehicle.js';
import type { VehicleRepository } from '../domain/vehicle.repository.js';
import { VehicleOrmEntity } from './vehicle.orm-entity.js';

/** TypeORM implementation of the {@link VehicleRepository} port. */
@Injectable()
export class TypeOrmVehicleRepository implements VehicleRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly tenants: TenantContextService,
  ) {}

  async create(input: CreateVehicleInput): Promise<Vehicle> {
    const repository = this.repository();
    const entity = repository.create({
      tenantId: input.tenantId,
      plate: input.plate,
      type: input.type,
      capacityWeightKg: input.capacityWeightKg,
      capacityVolumeM3: input.capacityVolumeM3,
      status: input.status ?? 'active',
    });
    return toDomain(await repository.save(entity));
  }

  async findById(id: string): Promise<Vehicle | null> {
    const entity = await this.repository().findOne({
      where: { id, ...this.tenants.scope() },
    });
    return entity ? toDomain(entity) : null;
  }

  async findByPlate(tenantId: string, plate: string): Promise<Vehicle | null> {
    const entity = await this.repository().findOne({
      where: { tenantId, plate },
    });
    return entity ? toDomain(entity) : null;
  }

  async listByTenant(tenantId: string): Promise<Vehicle[]> {
    const entities = await this.repository().find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
    return entities.map(toDomain);
  }

  async update(
    id: string,
    changes: UpdateVehicleInput,
  ): Promise<Vehicle | null> {
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

  private repository(): Repository<VehicleOrmEntity> {
    return this.txHost.tx.getRepository(VehicleOrmEntity);
  }
}

function toDomain(entity: VehicleOrmEntity): Vehicle {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    plate: entity.plate,
    type: entity.type as VehicleType,
    capacityWeightKg: entity.capacityWeightKg,
    capacityVolumeM3: entity.capacityVolumeM3,
    status: entity.status as VehicleStatus,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
