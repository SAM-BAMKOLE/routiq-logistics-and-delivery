import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { TenantsService } from '../application/tenants.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { TenantListResponseDto } from './dto/tenant-list-response.dto.js';
import { TenantResponseDto } from './dto/tenant-response.dto.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import {
  PLATFORM_ADMIN_HEADER,
  PlatformAdminGuard,
} from './platform-admin.guard.js';

/**
 * Platform administration: who the tenants are, not what each tenant does.
 *
 * These routes sit outside any tenant context (the registry is global), so no
 * tenant transaction is opened for them. Only platform admins may call them.
 */
@ApiTags('platform')
@ApiHeader({
  name: PLATFORM_ADMIN_HEADER,
  description: 'Platform admin key (interim until JWT platform-admin lands).',
})
@ApiUnauthorizedResponse({ description: 'Missing or invalid platform admin key.' })
@UseGuards(PlatformAdminGuard)
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new tenant' })
  @ApiCreatedResponse({ type: TenantResponseDto })
  async create(@Body() dto: CreateTenantDto): Promise<TenantResponseDto> {
    const tenant = await this.tenants.create(dto);
    return TenantResponseDto.from(tenant);
  }

  @Get()
  @ApiOperation({ summary: 'List tenants' })
  @ApiOkResponse({ type: TenantListResponseDto })
  async list(): Promise<TenantListResponseDto> {
    const tenants = await this.tenants.list();
    return { data: tenants.map((tenant) => TenantResponseDto.from(tenant)) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one tenant' })
  @ApiOkResponse({ type: TenantResponseDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TenantResponseDto> {
    return TenantResponseDto.from(await this.tenants.getById(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a tenant (name, plan, status, settings)' })
  @ApiOkResponse({ type: TenantResponseDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTenantDto,
  ): Promise<TenantResponseDto> {
    return TenantResponseDto.from(await this.tenants.update(id, dto));
  }
}
