import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { Repository } from 'typeorm';
import type {
  CreateDriverInput,
  CreateShiftInput,
  Driver,
  DriverAvailability,
  DriverShift,
  DriverStatus,
  UpdateDriverInput,
} from '../domain/driver.js';
import type {
  DriverRepository,
  ShiftRepository,
} from '../domain/driver.repository.js';
import { DriverOrmEntity } from './driver.orm-entity.js';
import { DriverShiftOrmEntity } from './driver-shift.orm-entity.js';

/** TypeORM implementation of the {@link DriverRepository} port. */
@Injectable()
export class TypeOrmDriverRepository implements DriverRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async create(
    input: CreateDriverInput & { tenantId: string },
  ): Promise<Driver> {
    const repository = this.repository();
    const entity = repository.create({
      tenantId: input.tenantId,
      membershipId: input.membershipId,
      licenseNo: input.licenseNo,
      status: input.status ?? 'active',
      currentVehicleId: input.currentVehicleId ?? null,
    });
    return toDriver(await repository.save(entity));
  }

  async findById(id: string): Promise<Driver | null> {
    const entity = await this.repository().findOne({ where: { id } });
    return entity ? toDriver(entity) : null;
  }

  async findByMembership(
    tenantId: string,
    membershipId: string,
  ): Promise<Driver | null> {
    const entity = await this.repository().findOne({
      where: { tenantId, membershipId },
    });
    return entity ? toDriver(entity) : null;
  }

  async findByLicense(
    tenantId: string,
    licenseNo: string,
  ): Promise<Driver | null> {
    const entity = await this.repository().findOne({
      where: { tenantId, licenseNo },
    });
    return entity ? toDriver(entity) : null;
  }

  async listByTenant(tenantId: string): Promise<Driver[]> {
    const entities = await this.repository().find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
    return entities.map(toDriver);
  }

  async update(id: string, changes: UpdateDriverInput): Promise<Driver | null> {
    const repository = this.repository();
    const entity = await repository.findOne({ where: { id } });
    if (!entity) {
      return null;
    }
    repository.merge(entity, changes);
    return toDriver(await repository.save(entity));
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.repository().delete({ id });
    return (result.affected ?? 0) > 0;
  }

  private repository(): Repository<DriverOrmEntity> {
    return this.txHost.tx.getRepository(DriverOrmEntity);
  }
}

/** TypeORM implementation of the {@link ShiftRepository} port. */
@Injectable()
export class TypeOrmShiftRepository implements ShiftRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async create(
    input: CreateShiftInput & { tenantId: string; driverId: string },
  ): Promise<DriverShift> {
    const repository = this.repository();
    const entity = repository.create({
      tenantId: input.tenantId,
      driverId: input.driverId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    return toShift(await repository.save(entity));
  }

  async findById(id: string): Promise<DriverShift | null> {
    const entity = await this.repository().findOne({ where: { id } });
    return entity ? toShift(entity) : null;
  }

  async listByDriver(driverId: string): Promise<DriverShift[]> {
    const entities = await this.repository().find({
      where: { driverId },
      order: { startsAt: 'ASC' },
    });
    return entities.map(toShift);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.repository().delete({ id });
    return (result.affected ?? 0) > 0;
  }

  private repository(): Repository<DriverShiftOrmEntity> {
    return this.txHost.tx.getRepository(DriverShiftOrmEntity);
  }
}

function toDriver(entity: DriverOrmEntity): Driver {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    membershipId: entity.membershipId,
    licenseNo: entity.licenseNo,
    status: entity.status as DriverStatus,
    availability: entity.availability as DriverAvailability,
    currentVehicleId: entity.currentVehicleId,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function toShift(entity: DriverShiftOrmEntity): DriverShift {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    driverId: entity.driverId,
    startsAt: entity.startsAt,
    endsAt: entity.endsAt,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
