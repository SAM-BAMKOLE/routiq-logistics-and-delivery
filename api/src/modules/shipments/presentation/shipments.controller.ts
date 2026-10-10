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
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { isRole, type Role } from '../../identity/domain/membership.js';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../identity/presentation/guards/permissions.guard.js';
import { RequirePermissions } from '../../identity/presentation/guards/require-permissions.decorator.js';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import type { Shipment } from '../domain/shipment.js';
import {
  ShipmentsService,
  type ShipmentActor,
} from '../application/shipments.service.js';
import {
  AssignShipmentDto,
  CreateShipmentDto,
  FailShipmentDto,
  ListShipmentsQueryDto,
  ReasonDto,
} from './dto/shipments.dto.js';
import {
  ShipmentListResponseDto,
  ShipmentResponseDto,
} from './dto/shipments-response.dto.js';
import { parseIfMatch } from './version-precondition.js';

/**
 * Shipment actions, one endpoint per state-machine transition. Read routes
 * accept the read / read-own / read-assigned permissions and the service
 * scopes rows per role; state changes need update (dispatchers) or
 * update-status (drivers), and every one of them requires `If-Match` with
 * the shipment's version so concurrent dispatchers cannot overwrite each
 * other. Responses carry the new version as an ETag for the next call.
 */
@ApiTags('shipments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('shipments')
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly context: TenantContextService,
  ) {}

  @Post()
  @RequirePermissions('shipments:create')
  @ApiOperation({ summary: 'Create a shipment (quoted synchronously)' })
  @ApiCreatedResponse({ type: ShipmentResponseDto })
  async create(
    @Res({ passthrough: true }) res: Response,
    @Body() dto: CreateShipmentDto,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.create(this.actor(), this.tenantId(), {
        customerId: dto.customerId,
        pickupAddressId: dto.pickupAddressId,
        dropoffAddressId: dto.dropoffAddressId,
        weightKg: dto.weightKg,
        volumeM3: dto.volumeM3 ?? null,
        windowStart: dto.windowStart ? new Date(dto.windowStart) : null,
        windowEnd: dto.windowEnd ? new Date(dto.windowEnd) : null,
        items: dto.items?.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          weightKg: item.weightKg ?? null,
        })),
      }),
    );
  }

  @Get()
  @RequirePermissions('shipments:read', 'shipments:read-own', 'shipments:read-assigned')
  @ApiOperation({ summary: 'List shipments visible to the caller' })
  @ApiOkResponse({ type: ShipmentListResponseDto })
  async list(@Query() query: ListShipmentsQueryDto): Promise<ShipmentListResponseDto> {
    const shipments = await this.shipments.list(this.actor(), this.tenantId(), {
      status: query.status,
      customerId: query.customerId,
    });
    return { data: shipments.map((s) => ShipmentResponseDto.from(s)) };
  }

  @Get(':id')
  @RequirePermissions('shipments:read', 'shipments:read-own', 'shipments:read-assigned')
  @ApiOperation({ summary: 'Get one shipment (ETag carries its version)' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  async get(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.get(this.actor(), this.tenantId(), id),
    );
  }

  @Post(':id/confirm')
  @RequirePermissions('shipments:update', 'shipments:update-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a created shipment (CREATED to CONFIRMED)' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  async confirm(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.confirm(
        this.actor(),
        this.tenantId(),
        id,
        parseIfMatch(ifMatch),
      ),
    );
  }

  @Post(':id/cancel')
  @RequirePermissions('shipments:update', 'shipments:update-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a shipment (only before pickup)' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  async cancel(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.cancel(
        this.actor(),
        this.tenantId(),
        id,
        parseIfMatch(ifMatch),
        dto.reason ?? null,
      ),
    );
  }

  @Post(':id/assign')
  @RequirePermissions('shipments:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign a confirmed shipment to a driver' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  async assign(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignShipmentDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.assign(
        this.actor(),
        this.tenantId(),
        id,
        parseIfMatch(ifMatch),
        dto.driverId,
        dto.vehicleId ?? null,
      ),
    );
  }

  @Post(':id/pickup')
  @RequirePermissions('shipments:update', 'shipments:update-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the shipment picked up (ASSIGNED to PICKED_UP)' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  async pickup(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.pickup(
        this.actor(),
        this.tenantId(),
        id,
        parseIfMatch(ifMatch),
      ),
    );
  }

  @Post(':id/start-transit')
  @RequirePermissions('shipments:update', 'shipments:update-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start transit (PICKED_UP to IN_TRANSIT)' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  async startTransit(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.startTransit(
        this.actor(),
        this.tenantId(),
        id,
        parseIfMatch(ifMatch),
      ),
    );
  }

  @Post(':id/start-delivery')
  @RequirePermissions('shipments:update', 'shipments:update-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Out for delivery (IN_TRANSIT to OUT_FOR_DELIVERY)' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  async startDelivery(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.startDelivery(
        this.actor(),
        this.tenantId(),
        id,
        parseIfMatch(ifMatch),
      ),
    );
  }

  @Post(':id/deliver')
  @RequirePermissions('shipments:update', 'shipments:update-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deliver the shipment (OUT_FOR_DELIVERY to DELIVERED)' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  async deliver(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.deliver(
        this.actor(),
        this.tenantId(),
        id,
        parseIfMatch(ifMatch),
      ),
    );
  }

  @Post(':id/fail')
  @RequirePermissions('shipments:update', 'shipments:update-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a failed delivery attempt (with reason)' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  async fail(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FailShipmentDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.fail(
        this.actor(),
        this.tenantId(),
        id,
        parseIfMatch(ifMatch),
        dto.reason,
      ),
    );
  }

  @Post(':id/retry')
  @RequirePermissions('shipments:update', 'shipments:update-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry a failed attempt (until the limit, then return)' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  async retry(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.retry(
        this.actor(),
        this.tenantId(),
        id,
        parseIfMatch(ifMatch),
      ),
    );
  }

  @Post(':id/return')
  @RequirePermissions('shipments:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Return the shipment to the sender' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  async returnShipment(
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ShipmentResponseDto> {
    return this.present(
      res,
      await this.shipments.returnShipment(
        this.actor(),
        this.tenantId(),
        id,
        parseIfMatch(ifMatch),
        dto.reason ?? null,
      ),
    );
  }

  private tenantId(): string {
    return this.context.requireTenantId();
  }

  /** The authenticated principal as the service layer wants it. */
  private actor(): ShipmentActor {
    const principal = this.context.get();
    const role: unknown = principal?.role;
    // JwtAuthGuard guarantees a principal with a tenant role; anything else
    // is a programming error, never a silent anonymous request.
    if (!principal?.userId || !isRole(role)) {
      throw new Error('No authenticated tenant principal in context.');
    }
    return { userId: principal.userId, role: role as Role };
  }

  private present(res: Response, shipment: Shipment): ShipmentResponseDto {
    res.setHeader('ETag', `"${shipment.version}"`);
    return ShipmentResponseDto.from(shipment);
  }
}
