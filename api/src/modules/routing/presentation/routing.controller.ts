import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { isRole, type Role } from '../../identity/domain/membership.js';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../identity/presentation/guards/permissions.guard.js';
import { RequirePermissions } from '../../identity/presentation/guards/require-permissions.decorator.js';
import { parseIfMatch } from '../../../shared/http/parse-if-match.js';
import { APP_PREFIX } from '../../../constants.js';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import {
  RoutingService,
  type RoutingActor,
} from '../application/routing.service.js';
import {
  PlanAcceptedResponseDto,
  ReplanResponseDto,
  RouteListResponseDto,
  RoutePlanResponseDto,
  RouteResponseDto,
} from './dto/routing-response.dto.js';
import { ListRoutesQueryDto, PlanRouteDto } from './dto/routing.dto.js';

/**
 * Routing endpoints, split along the guard line the roles draw:
 *
 * - dispatchers (`routes:manage`) plan runs, read any route, start one, and
 *   replan it (both guarded by `If-Match`, like shipments);
 * - drivers (`routes:read-own`) read their own routes; the service re-checks
 *   that the route belongs to the caller's driver profile, so the guard only
 *   decides *which kind* of caller may knock, never *which row* they get.
 *
 * `POST /routes/plan` answers 202 with a status URL: the optimizer runs in
 * the background (phase 1 in-process; phase 2 on the queue) and the caller
 * polls `GET /routes/plans/:id`.
 */
@ApiTags('routing')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class RoutingController {
  constructor(
    private readonly routing: RoutingService,
    private readonly context: TenantContextService,
  ) {}

  @Post('routes/plan')
  @RequirePermissions('routes:manage')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Plan routes for a date (202: poll the status URL)',
  })
  @ApiAcceptedResponse({ type: PlanAcceptedResponseDto })
  async plan(
    @Res({ passthrough: true }) res: Response,
    @Body() dto: PlanRouteDto,
  ): Promise<PlanAcceptedResponseDto> {
    const accepted = await this.routing.plan(
      this.actor(),
      this.tenantId(),
      dto,
    );
    const statusUrl = `/${APP_PREFIX}/routes/plans/${accepted.id}`;
    res.setHeader('Location', statusUrl);
    return PlanAcceptedResponseDto.from(accepted, statusUrl);
  }

  @Get('routes/plans/:id')
  @RequirePermissions('routes:manage')
  @ApiOperation({ summary: 'A planning run: status, unassigned stops, routes' })
  @ApiOkResponse({ type: RoutePlanResponseDto })
  async planResult(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RoutePlanResponseDto> {
    return RoutePlanResponseDto.from(
      await this.routing.getPlan(this.actor(), this.tenantId(), id),
    );
  }

  @Get('routes')
  @RequirePermissions('routes:manage', 'routes:read-own')
  @ApiOperation({
    summary: 'List routes (drivers automatically see only their own)',
  })
  @ApiOkResponse({ type: RouteListResponseDto })
  async list(
    @Query() query: ListRoutesQueryDto,
  ): Promise<RouteListResponseDto> {
    const routes = await this.routing.listRoutes(this.actor(), this.tenantId(), {
      planDate: query.planDate,
      status: query.status,
      driverId: query.driverId,
    });
    return { data: routes.map((route) => RouteResponseDto.from(route)) };
  }

  @Get('routes/:id')
  @RequirePermissions('routes:manage', 'routes:read-own')
  @ApiOperation({ summary: 'Get one route (ETag carries its version)' })
  @ApiOkResponse({ type: RouteResponseDto })
  async get(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RouteResponseDto> {
    const found = await this.routing.getRoute(this.actor(), this.tenantId(), id);
    res.setHeader('ETag', `"${found.version}"`);
    return RouteResponseDto.from(found);
  }

  @Post('routes/:id/start')
  @RequirePermissions('routes:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start driving a planned route (planned to active)' })
  @ApiOkResponse({ type: RouteResponseDto })
  async start(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<RouteResponseDto> {
    const found = await this.routing.start(
      this.actor(),
      this.tenantId(),
      id,
      parseIfMatch(ifMatch, 'route'),
    );
    res.setHeader('ETag', `"${found.version}"`);
    return RouteResponseDto.from(found);
  }

  @Post('routes/:id/replan')
  @RequirePermissions('routes:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Re-solve the remaining stops in place (unplaceable ones leave the route)',
  })
  @ApiOkResponse({ type: ReplanResponseDto })
  async replan(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ReplanResponseDto> {
    const result = await this.routing.replan(
      this.actor(),
      this.tenantId(),
      id,
      parseIfMatch(ifMatch, 'route'),
    );
    res.setHeader('ETag', `"${result.route.version}"`);
    return {
      route: RouteResponseDto.from(result.route),
      unassigned: result.unassigned.map((stop) => ({
        stopId: stop.shipmentId,
        reason: stop.reason,
      })),
    };
  }

  private tenantId(): string {
    return this.context.requireTenantId();
  }

  /** The authenticated principal as the service layer wants it. */
  private actor(): RoutingActor {
    const principal = this.context.get();
    const role: unknown = principal?.role;
    // JwtAuthGuard guarantees a principal with a tenant role; anything else
    // is a programming error, never a silent anonymous request.
    if (!principal?.userId || !isRole(role)) {
      throw new Error('No authenticated tenant principal in context.');
    }
    return { userId: principal.userId, role: role as Role };
  }
}
