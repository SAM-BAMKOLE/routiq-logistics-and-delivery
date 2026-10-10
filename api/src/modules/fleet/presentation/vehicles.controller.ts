import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../identity/presentation/guards/permissions.guard.js';
import { RequirePermissions } from '../../identity/presentation/guards/require-permissions.decorator.js';
import { VehiclesService } from '../application/vehicles.service.js';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicles.dto.js';
import {
  VehicleListResponseDto,
  VehicleResponseDto,
} from './dto/vehicles-response.dto.js';

/**
 * Fleet vehicles. Reads need `fleet:read`, writes need `fleet:manage`.
 * Plates are unique per tenant and reported as 409 on collision.
 */
@ApiTags('fleet')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly context: TenantContextService,
  ) {}

  @Post()
  @RequirePermissions('fleet:manage')
  @ApiOperation({ summary: 'Register a vehicle' })
  @ApiCreatedResponse({ type: VehicleResponseDto })
  async create(@Body() dto: CreateVehicleDto): Promise<VehicleResponseDto> {
    return VehicleResponseDto.from(
      await this.vehicles.create({
        tenantId: this.context.requireTenantId(),
        plate: dto.plate,
        type: dto.type,
        capacityWeightKg: dto.capacityWeightKg,
        capacityVolumeM3: dto.capacityVolumeM3,
        status: dto.status,
      }),
    );
  }

  @Get()
  @RequirePermissions('fleet:read')
  @ApiOperation({ summary: 'List vehicles of the active tenant' })
  @ApiOkResponse({ type: VehicleListResponseDto })
  async list(): Promise<VehicleListResponseDto> {
    const vehicles = await this.vehicles.list(this.context.requireTenantId());
    return { data: vehicles.map((v) => VehicleResponseDto.from(v)) };
  }

  @Get(':id')
  @RequirePermissions('fleet:read')
  @ApiOperation({ summary: 'Get one vehicle' })
  @ApiOkResponse({ type: VehicleResponseDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<VehicleResponseDto> {
    return VehicleResponseDto.from(
      await this.vehicles.getById(this.context.requireTenantId(), id),
    );
  }

  @Patch(':id')
  @RequirePermissions('fleet:manage')
  @ApiOperation({ summary: 'Update a vehicle' })
  @ApiOkResponse({ type: VehicleResponseDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateVehicleDto,
  ): Promise<VehicleResponseDto> {
    return VehicleResponseDto.from(
      await this.vehicles.update(this.context.requireTenantId(), id, {
        plate: dto.plate,
        type: dto.type,
        capacityWeightKg: dto.capacityWeightKg,
        capacityVolumeM3: dto.capacityVolumeM3,
        status: dto.status,
      }),
    );
  }

  @Delete(':id')
  @RequirePermissions('fleet:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retire a vehicle from the fleet' })
  @ApiOkResponse({ description: 'Deleted.' })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.vehicles.remove(this.context.requireTenantId(), id);
  }
}
