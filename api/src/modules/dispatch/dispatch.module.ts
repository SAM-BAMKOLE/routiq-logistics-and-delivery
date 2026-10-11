import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriversModule } from '../drivers/drivers.module.js';
import { FleetModule } from '../fleet/fleet.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ShipmentsModule } from '../shipments/shipments.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { DispatchService } from './application/dispatch.service.js';
import { ASSIGNMENT_REPOSITORY } from './domain/assignment.repository.js';
import { AssignmentOrmEntity } from './infrastructure/assignment.orm-entity.js';
import { TypeOrmAssignmentRepository } from './infrastructure/typeorm-assignment.repository.js';
import { DispatchController } from './presentation/dispatch.controller.js';

/**
 * Dispatch module: ranked candidate search and the offer lifecycle. It sits
 * on top of shipments (the shipments service owns every status change, via
 * the trusted `applyAssignment`/`releaseAssignment` entry points), drivers
 * and fleet (eligibility and capacity), and tenants (per-tenant strategy,
 * TTL, and radius settings). The `driver_locations` table it ranks on is
 * written by the tracking module in Step 10.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AssignmentOrmEntity]),
    IdentityModule,
    ShipmentsModule,
    DriversModule,
    FleetModule,
    TenantsModule,
  ],
  controllers: [DispatchController],
  providers: [
    DispatchService,
    TypeOrmAssignmentRepository,
    { provide: ASSIGNMENT_REPOSITORY, useClass: TypeOrmAssignmentRepository },
  ],
  exports: [DispatchService],
})
export class DispatchModule {}
