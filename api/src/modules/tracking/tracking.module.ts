import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { RoutingModule } from '../routing/routing.module.js';
import { ShipmentsModule } from '../shipments/shipments.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { TrackingService } from './application/tracking.service.js';
import { TRACKING_REPOSITORY } from './domain/tracking.repository.js';
import { TypeOrmTrackingRepository } from './infrastructure/typeorm-tracking.repository.js';
import { PublicTrackingController } from './presentation/public-tracking.controller.js';
import { TrackingController } from './presentation/tracking.controller.js';
import { TrackingGateway } from './presentation/tracking.gateway.js';

/**
 * Tracking module: driver positions in, live positions out.
 *
 * Writes go to `driver_locations` (created in Step 8 for dispatch proximity,
 * now the history buffer). Reads cross into shipments, routes, and proofs of
 * delivery through raw SQL in its repository — the documented cross-module
 * pattern — while actor scoping itself is borrowed from the owning facades
 * (`ShipmentsService.get`, `RoutingService.getRoute`), so a foreign id is a
 * 404 everywhere and this module never re-implements ownership rules.
 *
 * The gateway rides on the same service: `location:update` over the socket
 * is the twin of `POST /tracking/locations`, and the `@OnEvent` handlers
 * rebroadcast domain events emitted anywhere in the app to the rooms that
 * care. Phase 2 adds the Redis adapter; the surface stays identical.
 */
@Module({
  imports: [IdentityModule, DriversModule, RoutingModule, ShipmentsModule, TenantsModule],
  controllers: [TrackingController, PublicTrackingController],
  providers: [
    TrackingService,
    TrackingGateway,
    TypeOrmTrackingRepository,
    { provide: TRACKING_REPOSITORY, useClass: TypeOrmTrackingRepository },
  ],
  exports: [TrackingService],
})
export class TrackingModule {}
