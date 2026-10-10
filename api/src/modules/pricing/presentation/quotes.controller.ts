import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../identity/presentation/guards/permissions.guard.js';
import { RequirePermissions } from '../../identity/presentation/guards/require-permissions.decorator.js';
import { QuotesService } from '../application/quotes.service.js';
import { QuoteRequestDto } from './dto/pricing.dto.js';
import { QuoteResponseDto } from './dto/pricing-response.dto.js';

/**
 * Quote endpoint. Customers price a delivery before ordering it; the same
 * engine runs inside shipment creation, so the two can never disagree.
 */
@ApiTags('pricing')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly context: TenantContextService,
  ) {}

  @Post()
  @RequirePermissions('quotes:create')
  @ApiOperation({ summary: 'Price a pickup-to-drop-off delivery' })
  @ApiOkResponse({ type: QuoteResponseDto })
  async quote(@Body() dto: QuoteRequestDto): Promise<QuoteResponseDto> {
    return QuoteResponseDto.from(
      await this.quotes.quote(this.context.requireTenantId(), {
        pickupAddressId: dto.pickupAddressId,
        dropoffAddressId: dto.dropoffAddressId,
        weightKg: dto.weightKg,
      }),
    );
  }
}
