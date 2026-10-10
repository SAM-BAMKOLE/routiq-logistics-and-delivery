import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module.js';
import { VehiclesService } from './application/vehicles.service.js';
import { VEHICLE_REPOSITORY } from './domain/vehicle.repository.js';
import { VehicleOrmEntity } from './infrastructure/vehicle.orm-entity.js';
import { TypeOrmVehicleRepository } from './infrastructure/typeorm-vehicle.repository.js';
import { VehiclesController } from './presentation/vehicles.controller.js';

/**
 * Fleet module: vehicles and their capacities. `VehiclesService` is exported
 * so the drivers module can validate vehicle assignments through the
 * application facade rather than reaching into persistence.
 */
@Module({
  imports: [TypeOrmModule.forFeature([VehicleOrmEntity]), IdentityModule],
  controllers: [VehiclesController],
  providers: [
    VehiclesService,
    TypeOrmVehicleRepository,
    { provide: VEHICLE_REPOSITORY, useClass: TypeOrmVehicleRepository },
  ],
  exports: [VehiclesService],
})
export class FleetModule {}
