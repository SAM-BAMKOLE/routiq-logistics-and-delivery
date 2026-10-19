import { ApiProperty } from '@nestjs/swagger';
import { SHIPMENT_STATUSES } from '../../domain/shipment-status.js';
import type { Shipment } from '../../domain/shipment.js';
import type { ShipmentStatus } from '../../domain/shipment-status.js';
import { QuoteResponseDto } from '../../../pricing/presentation/dto/pricing-response.dto.js';

class ShipmentItemResponseDto {
  @ApiProperty()
  description: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty({ nullable: true })
  weightKg: number | null;
}

export class ShipmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'SHP-K7M2N9PQ4R8T' })
  trackingNumber: string;

  @ApiProperty({
    example: '9f2c1a7e4b3d5c6a8e0f1b2d3c4a5b6c',
    description:
      'Second secret of the public tracking URL: ' +
      '/api/v1/public/tracking/{trackingNumber}?token={publicToken}.',
  })
  publicToken: string;

  @ApiProperty({ format: 'uuid' })
  customerId: string;

  @ApiProperty({ format: 'uuid' })
  pickupAddressId: string;

  @ApiProperty({ format: 'uuid' })
  dropoffAddressId: string;

  @ApiProperty({ enum: SHIPMENT_STATUSES })
  status: ShipmentStatus;

  @ApiProperty()
  weightKg: number;

  @ApiProperty({ nullable: true })
  volumeM3: number | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  windowStart: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  windowEnd: string | null;

  @ApiProperty({ nullable: true, description: 'Quoted price in minor units.' })
  priceMinor: number | null;

  @ApiProperty({
    type: QuoteResponseDto,
    nullable: true,
    description: 'Itemised quote captured when the shipment was created.',
  })
  priceBreakdown: QuoteResponseDto | null;

  @ApiProperty({ example: 'NGN' })
  currency: string;

  @ApiProperty({ description: 'Failed delivery attempts so far.' })
  failedAttempts: number;

  @ApiProperty({
    nullable: true,
    format: 'uuid',
    description: 'Driver currently assigned to this shipment, if any.',
  })
  driverId: string | null;

  @ApiProperty({
    nullable: true,
    format: 'uuid',
    description: 'Vehicle currently assigned to this shipment, if any.',
  })
  vehicleId: string | null;

  @ApiProperty({ description: 'Optimistic-lock version (the ETag value).' })
  version: number;

  @ApiProperty({ type: [ShipmentItemResponseDto] })
  items: ShipmentItemResponseDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  static from(shipment: Shipment): ShipmentResponseDto {
    return {
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
      publicToken: shipment.publicToken,
      customerId: shipment.customerId,
      pickupAddressId: shipment.pickupAddressId,
      dropoffAddressId: shipment.dropoffAddressId,
      status: shipment.status,
      weightKg: shipment.weightKg,
      volumeM3: shipment.volumeM3,
      windowStart: shipment.windowStart ? shipment.windowStart.toISOString() : null,
      windowEnd: shipment.windowEnd ? shipment.windowEnd.toISOString() : null,
      priceMinor: shipment.priceMinor,
      priceBreakdown: shipment.priceBreakdown
        ? QuoteResponseDto.from(shipment.priceBreakdown)
        : null,
      currency: shipment.currency,
      failedAttempts: shipment.failedAttempts,
      driverId: shipment.driverId,
      vehicleId: shipment.vehicleId,
      version: shipment.version,
      items: shipment.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        weightKg: item.weightKg,
      })),
      createdAt: shipment.createdAt.toISOString(),
      updatedAt: shipment.updatedAt.toISOString(),
    };
  }
}

export class ShipmentListResponseDto {
  @ApiProperty({ type: [ShipmentResponseDto] })
  data: ShipmentResponseDto[];
}
