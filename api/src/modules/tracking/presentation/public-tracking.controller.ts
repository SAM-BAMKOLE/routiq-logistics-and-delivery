import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  PublicTrackingResponseDto,
} from './dto/tracking-response.dto.js';
import { TrackingService } from '../application/tracking.service.js';

/**
 * Anonymous tracking: `GET /public/tracking/:trackingNumber?token=…`.
 *
 * No login, no tenant context, minimal view. Both halves of the pair must
 * match — a wrong tracking number and a wrong token answer identically, so
 * the endpoint cannot be used to probe which tracking numbers exist. The
 * route is rate limited per IP (30/min) on top of the app-wide default;
 * the driver's position appears only while the shipment is out for delivery.
 *
 * The lookup runs through the `SECURITY DEFINER` SQL function (migration 15)
 * because RLS would hide every row from a request with no tenant, and the
 * view itself is then read under the resolved tenant's RLS.
 */
@ApiTags('public')
@SkipThrottle({ default: true })
@UseGuards(ThrottlerGuard)
@Controller('public/tracking')
export class PublicTrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get(':trackingNumber')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Track a shipment by number and public token',
    description:
      'Requires the `token` query parameter (the shipment’s public token). ' +
      'An unknown number and a wrong token answer identically with 404.',
  })
  @ApiOkResponse({ type: PublicTrackingResponseDto })
  async track(
    @Param('trackingNumber') trackingNumber: string,
    @Query('token') token?: string,
  ): Promise<PublicTrackingResponseDto> {
    const view = await this.tracking.publicTracking(trackingNumber, token ?? '');
    if (!view) {
      throw notFound();
    }
    return PublicTrackingResponseDto.from(view);
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({
    message: 'No shipment matches this tracking number and token.',
    code: 'TRACKING_NOT_FOUND',
  });
}
