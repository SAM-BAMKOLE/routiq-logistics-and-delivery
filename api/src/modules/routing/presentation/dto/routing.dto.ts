import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ROUTE_STATUSES } from '../../domain/route.js';
import {
  ROUTING_STRATEGIES,
  type RoutingStrategyName,
} from '../../optimization/strategy.js';

/** Body of `POST /routes/plan`: what to plan, how, and with which seed. */
export class PlanRouteDto {
  @ApiProperty({
    description:
      'Day to plan, as a calendar date (2026-10-12). Shipments whose window touches the day and is not yet routed become stops.',
    format: 'date',
  })
  @IsDateString()
  planDate: string;

  @ApiPropertyOptional({
    enum: ROUTING_STRATEGIES,
    description:
      'Construction/improvement strategy; defaults to the tenant’s routing.strategy (annealing).',
  })
  @IsOptional()
  @IsIn(ROUTING_STRATEGIES)
  strategy?: RoutingStrategyName;

  @ApiPropertyOptional({
    description:
      'Random seed; the plan records it so a run can be replayed and benchmarked.',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  seed?: string;
}

/** Query of `GET /routes`. */
export class ListRoutesQueryDto {
  @ApiPropertyOptional({ description: 'Only routes planned for this day.', format: 'date' })
  @IsOptional()
  @IsDateString()
  planDate?: string;

  @ApiPropertyOptional({ enum: ROUTE_STATUSES })
  @IsOptional()
  @IsIn(ROUTE_STATUSES)
  status?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only this driver’s routes (dispatchers only; drivers are scoped automatically).',
  })
  @IsOptional()
  @IsUUID()
  driverId?: string;
}
