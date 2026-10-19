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
import { PricingRulesService } from '../application/pricing-rules.service.js';
import { CreatePricingRuleDto, UpdatePricingRuleDto } from './dto/pricing.dto.js';
import {
  PricingRuleListResponseDto,
  PricingRuleResponseDto,
  SurchargeCatalogResponseDto,
} from './dto/pricing-response.dto.js';

/**
 * Tenant rate cards. Per the role table, pricing is tenant-admin territory:
 * dispatchers can read shipment prices but not manage the rules behind them.
 */
@ApiTags('pricing')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pricing-rules')
export class PricingRulesController {
  constructor(
    private readonly rules: PricingRulesService,
    private readonly context: TenantContextService,
  ) {}

  @Post()
  @RequirePermissions('pricing:manage')
  @ApiOperation({ summary: 'Create a rate card rule' })
  @ApiCreatedResponse({ type: PricingRuleResponseDto })
  async create(
    @Body() dto: CreatePricingRuleDto,
  ): Promise<PricingRuleResponseDto> {
    return PricingRuleResponseDto.from(
      await this.rules.create(this.context.requireTenantId(), {
        name: dto.name,
        baseFeeMinor: dto.baseFeeMinor,
        perKmMinor: dto.perKmMinor,
        perKgMinor: dto.perKgMinor,
        minFeeMinor: dto.minFeeMinor,
        priority: dto.priority,
        activeFrom: dto.activeFrom ? new Date(dto.activeFrom) : undefined,
        surcharges: dto.surcharges,
      }),
    );
  }

  @Get()
  @RequirePermissions('pricing:read')
  @ApiOperation({ summary: 'List rate card rules of the active tenant' })
  @ApiOkResponse({ type: PricingRuleListResponseDto })
  async list(): Promise<PricingRuleListResponseDto> {
    const rules = await this.rules.list(this.context.requireTenantId());
    return { data: rules.map((rule) => PricingRuleResponseDto.from(rule)) };
  }

  /**
   * The surcharge catalogue of the active rate card, for the booking form.
   * Any role that can book a shipment (or read pricing) may see it - it is
   * the list of optional extras a customer can pick, not the rate card
   * arithmetic. Declared before `:id` so it is not captured as a UUID.
   */
  @Get('surcharge-catalog')
  @RequirePermissions('shipments:create', 'pricing:read')
  @ApiOperation({ summary: 'Surcharges of the active rate card' })
  @ApiOkResponse({ type: SurchargeCatalogResponseDto })
  async surchargeCatalog(): Promise<SurchargeCatalogResponseDto> {
    return SurchargeCatalogResponseDto.from(
      await this.rules.surchargeCatalog(this.context.requireTenantId()),
    );
  }

  @Get(':id')
  @RequirePermissions('pricing:read')
  @ApiOperation({ summary: 'Get one rate card rule' })
  @ApiOkResponse({ type: PricingRuleResponseDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PricingRuleResponseDto> {
    return PricingRuleResponseDto.from(
      await this.rules.getById(this.context.requireTenantId(), id),
    );
  }

  @Patch(':id')
  @RequirePermissions('pricing:manage')
  @ApiOperation({ summary: 'Update a rate card rule' })
  @ApiOkResponse({ type: PricingRuleResponseDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePricingRuleDto,
  ): Promise<PricingRuleResponseDto> {
    return PricingRuleResponseDto.from(
      await this.rules.update(this.context.requireTenantId(), id, {
        name: dto.name,
        baseFeeMinor: dto.baseFeeMinor,
        perKmMinor: dto.perKmMinor,
        perKgMinor: dto.perKgMinor,
        minFeeMinor: dto.minFeeMinor,
        priority: dto.priority,
        activeFrom: dto.activeFrom ? new Date(dto.activeFrom) : undefined,
        surcharges: dto.surcharges,
      }),
    );
  }

  @Delete(':id')
  @RequirePermissions('pricing:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a rate card rule' })
  @ApiOkResponse({ description: 'Deleted.' })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.rules.remove(this.context.requireTenantId(), id);
  }
}
