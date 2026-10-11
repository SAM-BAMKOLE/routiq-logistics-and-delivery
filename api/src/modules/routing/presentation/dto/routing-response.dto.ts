import { ApiProperty } from '@nestjs/swagger';
import { ROUTE_STATUSES, type RouteStatus } from '../../domain/route.js';
import type { RoutePlanRecord } from '../../domain/routing.repository.js';
import type { RouteStopRecord, RouteWithStops } from '../../domain/routing.repository.js';
import {
  ROUTING_STRATEGIES,
  type RoutingStrategyName,
} from '../../optimization/strategy.js';
import type { PlanRouteAccepted } from '../../application/routing.service.js';

export class RouteStopResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'The shipment this stop serves.' })
  shipmentId: string;

  @ApiProperty({ description: '1-based position in the tour.' })
  sequence: number;

  @ApiProperty({
    description: 'v1 plans drop-off stops only; pickup stops arrive with PDPTW.',
  })
  kind: string;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'Planned arrival, from the optimizer’s schedule.',
  })
  plannedArrival: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  windowStart: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  windowEnd: string | null;

  static from(stop: RouteStopRecord): RouteStopResponseDto {
    return {
      id: stop.id,
      shipmentId: stop.shipmentId,
      sequence: stop.sequence,
      kind: stop.kind,
      plannedArrival: stop.plannedArrival?.toISOString() ?? null,
      windowStart: stop.windowStart?.toISOString() ?? null,
      windowEnd: stop.windowEnd?.toISOString() ?? null,
    };
  }
}

export class RouteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ nullable: true, format: 'uuid', description: 'The plan run that produced it.' })
  planId: string | null;

  @ApiProperty({ format: 'date' })
  planDate: string;

  @ApiProperty({ enum: ROUTE_STATUSES })
  status: RouteStatus;

  @ApiProperty({ nullable: true, format: 'uuid' })
  vehicleId: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  driverId: string | null;

  @ApiProperty({ description: 'Tour distance in metres (rounded).' })
  totalDistanceM: number;

  @ApiProperty({ description: 'Tour time in seconds: driving, waiting, service.' })
  totalDurationS: number;

  @ApiProperty({ description: 'Strategy that produced (or last replanned) the route.' })
  algorithm: string;

  @ApiProperty({ description: 'Objective value of this route under the tenant weights.' })
  objectiveValue: number;

  @ApiProperty({
    description: 'Optimistic-lock version; send it back in If-Match on start/replan.',
  })
  version: number;

  @ApiProperty({ type: [RouteStopResponseDto] })
  stops: RouteStopResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  static from(found: RouteWithStops): RouteResponseDto {
    return {
      id: found.route.id,
      planId: found.route.planId,
      planDate: found.route.planDate,
      status: found.route.status,
      vehicleId: found.route.vehicleId,
      driverId: found.route.driverId,
      totalDistanceM: Math.round(found.route.metrics.totalDistanceMeters),
      totalDurationS: Math.round(found.route.metrics.totalDurationSeconds),
      algorithm: found.route.algorithm,
      objectiveValue: found.route.metrics.objectiveValue,
      version: found.version,
      stops: found.stops.map((stop) => RouteStopResponseDto.from(stop)),
      createdAt: found.route.createdAt.toISOString(),
      updatedAt: found.route.updatedAt.toISOString(),
    };
  }
}

export class RouteListResponseDto {
  @ApiProperty({ type: [RouteResponseDto] })
  data: RouteResponseDto[];
}

export class PlanAcceptedResponseDto {
  @ApiProperty({ format: 'uuid', description: 'The planning run; poll it at statusUrl.' })
  id: string;

  @ApiProperty({ format: 'date' })
  planDate: string;

  @ApiProperty({ enum: ['planning'] })
  status: 'planning';

  @ApiProperty({ enum: ROUTING_STRATEGIES })
  strategy: RoutingStrategyName;

  @ApiProperty({ description: 'Seed of this run; reuse it to replay the plan.' })
  seed: string;

  @ApiProperty({ description: 'Optimizer time budget per run (safety cap).' })
  timeBudgetMs: number;

  @ApiProperty({
    description: 'Poll this URL until status becomes planned (or failed).',
  })
  statusUrl: string;

  static from(accepted: PlanRouteAccepted, statusUrl: string): PlanAcceptedResponseDto {
    return { ...accepted, statusUrl };
  }
}

export class UnassignedStopResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The shipment that could not be planned.',
  })
  stopId: string;

  @ApiProperty({
    description:
      'Why: no_coordinates, no_feasible_vehicle, capacity_exceeded, time_window_infeasible, or shift_exceeded.',
  })
  reason: string;
}

export class RoutePlanResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date' })
  planDate: string;

  @ApiProperty({
    enum: ['planning', 'planned', 'failed'],
    description: 'Poll until planned; failed carries the error.',
  })
  status: 'planning' | 'planned' | 'failed';

  @ApiProperty({ enum: ROUTING_STRATEGIES })
  strategy: string;

  @ApiProperty()
  seed: string;

  @ApiProperty()
  timeBudgetMs: number;

  @ApiProperty({ nullable: true, format: 'uuid' })
  requestedBy: string | null;

  @ApiProperty({
    nullable: true,
    type: [UnassignedStopResponseDto],
    description: 'Stops the optimizer could not place, with reasons.',
  })
  unassigned: UnassignedStopResponseDto[] | null;

  @ApiProperty({ nullable: true, description: 'Present when status is failed.' })
  error: string | null;

  @ApiProperty({ nullable: true })
  routesCreated: number | null;

  @ApiProperty({ nullable: true, description: 'Planned metres across all routes.' })
  totalDistanceM: number | null;

  @ApiProperty({ nullable: true, description: 'Planned seconds across all routes.' })
  totalDurationS: number | null;

  @ApiProperty({ nullable: true, description: 'Plan objective under the tenant weights.' })
  objectiveValue: number | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  @ApiProperty({
    type: [RouteResponseDto],
    description: 'The routes of this run (empty while still planning).',
  })
  routes: RouteResponseDto[];

  static from(view: {
    plan: RoutePlanRecord;
    routes: readonly RouteWithStops[];
  }): RoutePlanResponseDto {
    return {
      id: view.plan.id,
      planDate: view.plan.planDate,
      status: view.plan.status,
      strategy: view.plan.strategy,
      seed: view.plan.seed,
      timeBudgetMs: view.plan.timeBudgetMs,
      requestedBy: view.plan.requestedBy,
      unassigned: view.plan.unassigned
        ? view.plan.unassigned.map((stop) => ({
            stopId: stop.stopId,
            reason: stop.reason,
          }))
        : null,
      error: view.plan.error,
      routesCreated: view.plan.routesCreated,
      totalDistanceM:
        view.plan.totalDistanceM === null
          ? null
          : Math.round(view.plan.totalDistanceM),
      totalDurationS:
        view.plan.totalDurationS === null
          ? null
          : Math.round(view.plan.totalDurationS),
      objectiveValue: view.plan.objectiveValue,
      createdAt: view.plan.createdAt.toISOString(),
      updatedAt: view.plan.updatedAt.toISOString(),
      routes: view.routes.map((route) => RouteResponseDto.from(route)),
    };
  }
}

export class ReplanResponseDto {
  @ApiProperty({ type: RouteResponseDto })
  route: RouteResponseDto;

  @ApiProperty({
    type: [UnassignedStopResponseDto],
    description: 'Stops that fell out of the route (they leave the tour).',
  })
  unassigned: UnassignedStopResponseDto[];
}
