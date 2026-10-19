import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { EntityManager } from 'typeorm';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import {
  Shipment,
  type ShipmentItem,
} from '../domain/shipment.js';
import { isShipmentStatus } from '../domain/shipment-status.js';
import type {
  ShipmentListFilters,
  ShipmentRepository,
} from '../domain/shipment.repository.js';
import { ShipmentItemOrmEntity } from './shipment-item.orm-entity.js';
import { ShipmentOrmEntity } from './shipment.orm-entity.js';

/**
 * TypeORM implementation of the {@link ShipmentRepository} port. The
 * aggregate's `version` and TypeORM's `@VersionColumn` move in lockstep
 * because the service saves once per request, after exactly one transition.
 */
@Injectable()
export class TypeOrmShipmentRepository implements ShipmentRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly tenants: TenantContextService,
  ) {}

  async insert(shipment: Shipment): Promise<void> {
    const manager = this.manager();
    const entity = manager.create(ShipmentOrmEntity, {
      // The aggregate owns the id: history rows and events all reference it.
      id: shipment.id,
      tenantId: shipment.tenantId,
      trackingNumber: shipment.trackingNumber,
      publicToken: shipment.publicToken,
      customerId: shipment.customerId,
      pickupAddressId: shipment.pickupAddressId,
      dropoffAddressId: shipment.dropoffAddressId,
      status: shipment.status,
      weightKg: shipment.weightKg,
      volumeM3: shipment.volumeM3,
      windowStart: shipment.windowStart,
      windowEnd: shipment.windowEnd,
      priceMinor: shipment.priceMinor,
      priceBreakdown: shipment.priceBreakdown,
      currency: shipment.currency,
      failedAttempts: shipment.failedAttempts,
    });
    const saved = await manager.save(ShipmentOrmEntity, entity);
    await manager.insert(
      ShipmentItemOrmEntity,
      shipment.items.map((item) => ({
        tenantId: shipment.tenantId,
        shipmentId: saved.id,
        description: item.description,
        quantity: item.quantity,
        weightKg: item.weightKg,
      })),
    );
  }

  async save(shipment: Shipment): Promise<void> {
    const manager = this.manager();
    // Version is left to @VersionColumn: TypeORM bumps it on this update,
    // matching the aggregate's own increment from the same transition.
    await manager.update(
      ShipmentOrmEntity,
      { id: shipment.id, ...this.tenants.scope() },
      {
        status: shipment.status,
        failedAttempts: shipment.failedAttempts,
        driverId: shipment.driverId,
        vehicleId: shipment.vehicleId,
      },
    );
  }

  async findById(id: string): Promise<Shipment | null> {
    const manager = this.manager();
    const entity = await manager.findOne(ShipmentOrmEntity, {
      where: { id, ...this.tenants.scope() },
    });
    if (!entity) {
      return null;
    }
    const items = await manager.find(ShipmentItemOrmEntity, {
      where: { shipmentId: id, ...this.tenants.scope() },
      order: { createdAt: 'ASC' },
    });
    return toDomain(entity, items);
  }

  async listByTenant(
    tenantId: string,
    filters: ShipmentListFilters = {},
  ): Promise<Shipment[]> {
    const manager = this.manager();
    const entities = await manager.find(ShipmentOrmEntity, {
      where: {
        tenantId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.driverId ? { driverId: filters.driverId } : {}),
      },
      order: { createdAt: 'ASC' },
    });
    if (entities.length === 0) {
      return [];
    }
    const itemRows = await manager
      .getRepository(ShipmentItemOrmEntity)
      .createQueryBuilder('item')
      .where('item.tenant_id = :tenantId', { tenantId })
      .andWhere('item.shipment_id IN (:...shipmentIds)', {
        shipmentIds: entities.map((entity) => entity.id),
      })
      .orderBy('item.created_at', 'ASC')
      .getMany();
    const itemsByShipment = new Map<string, ShipmentItemOrmEntity[]>();
    for (const item of itemRows) {
      const list = itemsByShipment.get(item.shipmentId) ?? [];
      list.push(item);
      itemsByShipment.set(item.shipmentId, list);
    }
    return entities.map((entity) =>
      toDomain(entity, itemsByShipment.get(entity.id) ?? []),
    );
  }

  private manager(): EntityManager {
    return this.txHost.tx;
  }
}

function toDomain(
  entity: ShipmentOrmEntity,
  itemEntities: readonly ShipmentItemOrmEntity[],
): Shipment {
  if (!isShipmentStatus(entity.status)) {
    throw new Error(
      `Shipment ${entity.id} has unknown status "${entity.status}".`,
    );
  }
  const items: ShipmentItem[] = itemEntities.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    weightKg: item.weightKg,
  }));
  return Shipment.rehydrate({
    id: entity.id,
    tenantId: entity.tenantId,
    trackingNumber: entity.trackingNumber,
    publicToken: entity.publicToken,
    customerId: entity.customerId,
    pickupAddressId: entity.pickupAddressId,
    dropoffAddressId: entity.dropoffAddressId,
    status: entity.status,
    weightKg: entity.weightKg,
    volumeM3: entity.volumeM3,
    windowStart: entity.windowStart,
    windowEnd: entity.windowEnd,
    priceMinor: entity.priceMinor,
    priceBreakdown: entity.priceBreakdown,
    currency: entity.currency,
    failedAttempts: entity.failedAttempts,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    driverId: entity.driverId,
    vehicleId: entity.vehicleId,
    items,
  });
}
