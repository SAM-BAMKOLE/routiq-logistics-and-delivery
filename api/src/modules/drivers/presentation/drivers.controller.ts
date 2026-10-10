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
import { DriversService } from '../application/drivers.service.js';
import {
  CreateDriverDto,
  CreateShiftDto,
  SetAvailabilityDto,
  UpdateDriverDto,
} from './dto/drivers.dto.js';
import {
  DriverListResponseDto,
  DriverResponseDto,
  ShiftListResponseDto,
  ShiftResponseDto,
} from './dto/drivers-response.dto.js';

/**
 * Drivers, their shifts, and availability. Reads need `drivers:read`, writes
 * need `drivers:manage`; a driver flips their own flag through
 * `/drivers/me/availability` (`drivers:manage-own`), and dispatchers adjust
 * anyone's through `/:id/availability` (`drivers:manage-availability`).
 */
@ApiTags('drivers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('drivers')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly context: TenantContextService,
  ) {}

  @Post()
  @RequirePermissions('drivers:manage')
  @ApiOperation({ summary: 'Create a driver profile for a membership' })
  @ApiCreatedResponse({ type: DriverResponseDto })
  async create(@Body() dto: CreateDriverDto): Promise<DriverResponseDto> {
    return DriverResponseDto.from(
      await this.drivers.createDriver(this.context.requireTenantId(), {
        membershipId: dto.membershipId,
        licenseNo: dto.licenseNo,
        status: dto.status,
        currentVehicleId: dto.currentVehicleId,
      }),
    );
  }

  @Get()
  @RequirePermissions('drivers:read')
  @ApiOperation({ summary: 'List drivers of the active tenant' })
  @ApiOkResponse({ type: DriverListResponseDto })
  async list(): Promise<DriverListResponseDto> {
    const drivers = await this.drivers.listDrivers(
      this.context.requireTenantId(),
    );
    return { data: drivers.map((d) => DriverResponseDto.from(d)) };
  }

  @Patch('me/availability')
  @RequirePermissions('drivers:manage-own')
  @ApiOperation({ summary: 'Set your own availability' })
  @ApiOkResponse({ type: DriverResponseDto })
  async setOwnAvailability(
    @Body() dto: SetAvailabilityDto,
  ): Promise<DriverResponseDto> {
    // JwtAuthGuard guarantees a principal; the explicit check keeps the
    // failure a programming error, never a silent empty-user lookup.
    const userId = this.context.get()?.userId;
    if (!userId) {
      throw new Error('No authenticated user in context.');
    }
    return DriverResponseDto.from(
      await this.drivers.setOwnAvailability(
        this.context.requireTenantId(),
        userId,
        dto.availability,
      ),
    );
  }

  @Get(':id')
  @RequirePermissions('drivers:read')
  @ApiOperation({ summary: 'Get one driver' })
  @ApiOkResponse({ type: DriverResponseDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DriverResponseDto> {
    return DriverResponseDto.from(
      await this.drivers.getDriver(this.context.requireTenantId(), id),
    );
  }

  @Patch(':id')
  @RequirePermissions('drivers:manage')
  @ApiOperation({ summary: 'Update a driver' })
  @ApiOkResponse({ type: DriverResponseDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDriverDto,
  ): Promise<DriverResponseDto> {
    return DriverResponseDto.from(
      await this.drivers.updateDriver(this.context.requireTenantId(), id, {
        licenseNo: dto.licenseNo,
        status: dto.status,
        availability: dto.availability,
        currentVehicleId: dto.currentVehicleId,
      }),
    );
  }

  @Patch(':id/availability')
  @RequirePermissions('drivers:manage-availability')
  @ApiOperation({ summary: "Set a driver's availability (dispatcher)" })
  @ApiOkResponse({ type: DriverResponseDto })
  async setAvailability(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetAvailabilityDto,
  ): Promise<DriverResponseDto> {
    return DriverResponseDto.from(
      await this.drivers.setAvailability(
        this.context.requireTenantId(),
        id,
        dto.availability,
      ),
    );
  }

  @Delete(':id')
  @RequirePermissions('drivers:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a driver and their shifts' })
  @ApiOkResponse({ description: 'Deleted.' })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.drivers.removeDriver(this.context.requireTenantId(), id);
  }

  @Post(':id/shifts')
  @RequirePermissions('drivers:manage')
  @ApiOperation({ summary: 'Add a shift for a driver' })
  @ApiCreatedResponse({ type: ShiftResponseDto })
  async createShift(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateShiftDto,
  ): Promise<ShiftResponseDto> {
    return ShiftResponseDto.from(
      await this.drivers.createShift(this.context.requireTenantId(), id, {
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
      }),
    );
  }

  @Get(':id/shifts')
  @RequirePermissions('drivers:read')
  @ApiOperation({ summary: 'List shifts of a driver' })
  @ApiOkResponse({ type: ShiftListResponseDto })
  async listShifts(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ShiftListResponseDto> {
    const shifts = await this.drivers.listShifts(
      this.context.requireTenantId(),
      id,
    );
    return { data: shifts.map((s) => ShiftResponseDto.from(s)) };
  }

  @Delete(':driverId/shifts/:shiftId')
  @RequirePermissions('drivers:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a shift of a driver' })
  @ApiOkResponse({ description: 'Deleted.' })
  async removeShift(
    @Param('driverId', new ParseUUIDPipe()) driverId: string,
    @Param('shiftId', new ParseUUIDPipe()) shiftId: string,
  ): Promise<void> {
    await this.drivers.removeShift(
      this.context.requireTenantId(),
      driverId,
      shiftId,
    );
  }
}
