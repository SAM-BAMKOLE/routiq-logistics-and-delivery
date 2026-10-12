import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { isRole, type Role } from '../../identity/domain/membership.js';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../identity/presentation/guards/permissions.guard.js';
import { RequirePermissions } from '../../identity/presentation/guards/require-permissions.decorator.js';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import {
  TrackingService,
  type TrackingActor,
} from '../application/tracking.service.js';
import {
  DriverLocationListResponseDto,
  DriverLocationResponseDto,
  IngestResponseDto,
  ShipmentTrackResponseDto,
} from './dto/tracking-response.dto.js';
import {
  LocationHistoryQueryDto,
  PushLocationsDto,
} from './dto/tracking.dto.js';

/**
 * Tracking endpoints: the ingest path drivers (and dispatchers pushing on
 * their behalf) use, and the read paths that answer "where is it now" and
 * "where has it been". Permissions split the two directions — `tracking:push`
 * for writes (drivers), `tracking:read` for reads (dispatchers) — and the
 * service re-checks which driver a caller may touch, so the guard only
 * decides *which kind* of caller may knock, never *which row* they get.
 */
@ApiTags('tracking')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class TrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly context: TenantContextService,
  ) {}

  @Post('tracking/locations')
  @RequirePermissions('tracking:push')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Push a batch of GPS positions',
    description:
      'Accepts points in any order (an offline device flushes its backlog on ' +
      'reconnect); the server sorts, then keeps only points that are fresh, ' +
      'plausible and worth storing, reporting the rest with a reason.',
  })
  @ApiOkResponse({ type: IngestResponseDto })
  async push(
    @Body() dto: PushLocationsDto,
  ): Promise<IngestResponseDto> {
    const result = await this.tracking.ingest(
      this.actor(),
      this.tenantId(),
      {
        driverId: dto.driverId ?? null,
        points: dto.points.map((point) => ({
          latitude: point.latitude,
          longitude: point.longitude,
          recordedAt: new Date(point.recordedAt),
          speedKmh: point.speedKmh ?? null,
          heading: point.heading ?? null,
        })),
      },
    );
    return IngestResponseDto.from(result);
  }

  @Get('drivers/:id/location')
  @RequirePermissions('tracking:read', 'drivers:manage-own')
  @ApiOperation({ summary: 'A driver’s newest recorded position' })
  @ApiOkResponse({ type: DriverLocationResponseDto })
  async latest(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DriverLocationResponseDto> {
    return DriverLocationResponseDto.from(
      await this.tracking.latestForDriver(this.actor(), this.tenantId(), id),
    );
  }

  @Get('drivers/:id/locations')
  @RequirePermissions('tracking:read', 'drivers:manage-own')
  @ApiOperation({
    summary: 'A thinned window of a driver’s position history',
    description:
      'Newest first, cursor-paginated on `recordedAt`; the buffer is thinned ' +
      'at write time by distance and interval.',
  })
  @ApiOkResponse({ type: DriverLocationListResponseDto })
  async history(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: LocationHistoryQueryDto,
  ): Promise<DriverLocationListResponseDto> {
    const points = await this.tracking.historyForDriver(
      this.actor(),
      this.tenantId(),
      id,
      {
        from: query.from ? new Date(query.from) : undefined,
        limit: query.limit,
      },
    );
    return { data: points.map((point) => DriverLocationResponseDto.from(point)) };
  }

  @Get('shipments/:id/track')
  @RequirePermissions(
    'shipments:read',
    'shipments:read-own',
    'shipments:read-assigned',
  )
  @ApiOperation({
    summary: 'Track a shipment: timeline, proofs, ETA, live position',
  })
  @ApiOkResponse({ type: ShipmentTrackResponseDto })
  async track(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ShipmentTrackResponseDto> {
    return ShipmentTrackResponseDto.from(
      await this.tracking.trackShipment(this.actor(), this.tenantId(), id),
    );
  }

  private tenantId(): string {
    return this.context.requireTenantId();
  }

  /** The authenticated principal as the service layer wants it. */
  private actor(): TrackingActor {
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
