import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FleetModule } from '../fleet/fleet.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { DriversService } from './application/drivers.service.js';
import {
  DRIVER_REPOSITORY,
  SHIFT_REPOSITORY,
} from './domain/driver.repository.js';
import { DriverOrmEntity } from './infrastructure/driver.orm-entity.js';
import { DriverShiftOrmEntity } from './infrastructure/driver-shift.orm-entity.js';
import {
  TypeOrmDriverRepository,
  TypeOrmShiftRepository,
} from './infrastructure/typeorm-driver.repository.js';
import { DriversController } from './presentation/drivers.controller.js';

/**
 * Drivers module: driver profiles linked to memberships, plus shifts.
 * Membership validation reuses the identity module's repository binding, and
 * vehicle assignment goes through the fleet facade — never across persistence
 * boundaries.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DriverOrmEntity, DriverShiftOrmEntity]),
    IdentityModule,
    FleetModule,
  ],
  controllers: [DriversController],
  providers: [
    DriversService,
    TypeOrmDriverRepository,
    TypeOrmShiftRepository,
    { provide: DRIVER_REPOSITORY, useClass: TypeOrmDriverRepository },
    { provide: SHIFT_REPOSITORY, useClass: TypeOrmShiftRepository },
  ],
  exports: [DriversService],
})
export class DriversModule {}
