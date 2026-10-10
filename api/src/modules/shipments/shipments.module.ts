import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { FleetModule } from '../fleet/fleet.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { ShipmentsService } from './application/shipments.service.js';
import {
  SHIPMENT_HISTORY_REPOSITORY,
  SHIPMENT_REPOSITORY,
} from './domain/shipment.repository.js';
import { ShipmentItemOrmEntity } from './infrastructure/shipment-item.orm-entity.js';
import { ShipmentStatusHistoryOrmEntity } from './infrastructure/shipment-status-history.orm-entity.js';
import { ShipmentOrmEntity } from './infrastructure/shipment.orm-entity.js';
import { TypeOrmShipmentHistoryRepository } from './infrastructure/typeorm-shipment-history.repository.js';
import { TypeOrmShipmentRepository } from './infrastructure/typeorm-shipment.repository.js';
import { ShipmentsController } from './presentation/shipments.controller.js';

/**
 * Shipments module: the aggregate, its state machine, items, and the
 * append-only status history. The pricing facade supplies the quote at
 * creation; customers, fleet, and drivers validate the identities a
 * shipment and its assignment reference. `ShipmentsService` is exported
 * because dispatch (Step 8) changes shipment status only through it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShipmentOrmEntity,
      ShipmentItemOrmEntity,
      ShipmentStatusHistoryOrmEntity,
    ]),
    IdentityModule,
    CustomersModule,
    PricingModule,
    TenantsModule,
    DriversModule,
    FleetModule,
  ],
  controllers: [ShipmentsController],
  providers: [
    ShipmentsService,
    TypeOrmShipmentRepository,
    TypeOrmShipmentHistoryRepository,
    { provide: SHIPMENT_REPOSITORY, useClass: TypeOrmShipmentRepository },
    { provide: SHIPMENT_HISTORY_REPOSITORY, useClass: TypeOrmShipmentHistoryRepository },
  ],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
