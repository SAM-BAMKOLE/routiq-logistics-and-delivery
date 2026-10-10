import { ApiProperty } from '@nestjs/swagger';
import { SHIPMENT_STATUSES } from '../../domain/shipment-status.js';
import type { Shipment } from '../../domain/shipment.js';
import type { ShipmentStatus } from '../../domain/shipment-status.js';

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

  @ApiProperty({ example: 'NGN' })
  currency: string;

  @ApiProperty({ description: 'Failed delivery attempts so far.' })
  failedAttempts: number;

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
      customerId: shipment.customerId,
      pickupAddressId: shipment.pickupAddressId,
      dropoffAddressId: shipment.dropoffAddressId,
      status: shipment.status,
      weightKg: shipment.weightKg,
      volumeM3: shipment.volumeM3,
      windowStart: shipment.windowStart ? shipment.windowStart.toISOString() : null,
      windowEnd: shipment.windowEnd ? shipment.windowEnd.toISOString() : null,
      priceMinor: shipment.priceMinor,
      currency: shipment.currency,
      failedAttempts: shipment.failedAttempts,
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
