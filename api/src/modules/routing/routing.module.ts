import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriversModule } from '../drivers/drivers.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { RoutingService } from './application/routing.service.js';
import { ROUTING_REPOSITORY } from './domain/routing.repository.js';
import { RouteOrmEntity } from './infrastructure/route.orm-entity.js';
import { RoutePlanOrmEntity } from './infrastructure/route-plan.orm-entity.js';
import { RouteStopOrmEntity } from './infrastructure/route-stop.orm-entity.js';
import { TypeOrmRoutingRepository } from './infrastructure/typeorm-routing.repository.js';
import { RoutingController } from './presentation/routing.controller.js';

/**
 * Routing module: CVRPTW planning over confirmed shipments — the pure
 * optimizer under `optimization/`, the plan run behind the 202 status URL,
 * and the route lifecycle (start, replan). It sits on drivers (driver
 * scoping of `routes:read-own`) and tenants (depot, weights, budgets);
 * vehicles it reads directly through its own repository queries.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RouteOrmEntity,
      RoutePlanOrmEntity,
      RouteStopOrmEntity,
    ]),
    IdentityModule,
    DriversModule,
    TenantsModule,
  ],
  controllers: [RoutingController],
  providers: [
    RoutingService,
    TypeOrmRoutingRepository,
    { provide: ROUTING_REPOSITORY, useClass: TypeOrmRoutingRepository },
  ],
  exports: [RoutingService],
})
export class RoutingModule {}
