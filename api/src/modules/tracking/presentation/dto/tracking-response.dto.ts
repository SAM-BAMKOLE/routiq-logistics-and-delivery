import { ApiProperty } from '@nestjs/swagger';
import type {
  LocationPointRow,
  RouteStopEta,
} from '../../domain/tracking.repository.js';
import type {
  IngestResult,
  PublicTrackingView,
  ShipmentTrackView,
} from '../../application/tracking.service.js';

class DiscardedPointDto {
  @ApiProperty({
    description: 'Index in the submitted array (before server-side sorting).',
  })
  index: number;

  @ApiProperty({
    enum: ['out_of_range', 'future', 'stale', 'implausible_speed', 'thinned'],
  })
  reason: string;
}

/** Body of `POST /tracking/locations`: what was kept, what was dropped. */
export class IngestResponseDto {
  @ApiProperty({ description: 'Points stored as history.' })
  accepted: number;

  @ApiProperty({ type: [DiscardedPointDto] })
  discarded: DiscardedPointDto[];

  static from(result: IngestResult): IngestResponseDto {
    return {
      accepted: result.accepted,
      discarded: result.discarded.map((point) => ({
        index: point.index,
        reason: point.reason,
      })),
    };
  }
}

export class DriverLocationResponseDto {
  @ApiProperty({ format: 'uuid' })
  driverId: string;

  @ApiProperty()
  latitude: number;

  @ApiProperty()
  longitude: number;

  @ApiProperty({ nullable: true })
  speedKmh: number | null;

  @ApiProperty({ nullable: true })
  heading: number | null;

  @ApiProperty({ format: 'date-time' })
  recordedAt: string;

  static from(point: LocationPointRow): DriverLocationResponseDto {
    return {
      driverId: point.driverId,
      latitude: point.latitude,
      longitude: point.longitude,
      speedKmh: point.speedKmh,
      heading: point.heading,
      recordedAt: point.recordedAt.toISOString(),
    };
  }
}

export class DriverLocationListResponseDto {
  @ApiProperty({ type: [DriverLocationResponseDto] })
  data: DriverLocationResponseDto[];
}

class TimelineEntryDto {
  @ApiProperty()
  toStatus: string;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty({ format: 'date-time' })
  occurredAt: string;
}

class ProofSummaryDto {
  @ApiProperty({ enum: ['photo', 'signature', 'otp'] })
  type: string;

  @ApiProperty({ nullable: true })
  recipientName: string | null;

  @ApiProperty({ format: 'date-time' })
  capturedAt: string;

  @ApiProperty({ nullable: true, format: 'date-time' })
  otpVerifiedAt: string | null;
}

class RouteEtaDto {
  @ApiProperty({ format: 'uuid' })
  routeId: string;

  @ApiProperty({ format: 'date-time' })
  plannedArrival: string;
}

/** The authenticated track view of one shipment. */
export class ShipmentTrackResponseDto {
  @ApiProperty({ format: 'uuid' })
  shipmentId: string;

  @ApiProperty()
  trackingNumber: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ nullable: true, format: 'date-time' })
  deliveredAt: string | null;

  @ApiProperty({ type: [TimelineEntryDto] })
  timeline: TimelineEntryDto[];

  @ApiProperty({ type: [ProofSummaryDto] })
  proofs: ProofSummaryDto[];

  @ApiProperty({ nullable: true, type: RouteEtaDto })
  eta: RouteEtaDto | null;

  @ApiProperty({ nullable: true, type: DriverLocationResponseDto })
  position: DriverLocationResponseDto | null;

  static from(view: ShipmentTrackView): ShipmentTrackResponseDto {
    return {
      shipmentId: view.shipmentId,
      trackingNumber: view.trackingNumber,
      status: view.status,
      deliveredAt: view.deliveredAt ? view.deliveredAt.toISOString() : null,
      timeline: view.timeline.map((entry) => ({
        toStatus: entry.toStatus,
        reason: entry.reason,
        occurredAt: entry.occurredAt.toISOString(),
      })),
      proofs: view.proofs.map((proof) => ({
        type: proof.type,
        recipientName: proof.recipientName,
        capturedAt: proof.capturedAt.toISOString(),
        otpVerifiedAt: proof.otpVerifiedAt
          ? proof.otpVerifiedAt.toISOString()
          : null,
      })),
      eta: view.eta ? routeEta(view.eta) : null,
      position: view.position
        ? DriverLocationResponseDto.from({
            driverId: view.position.driverId,
            latitude: view.position.latitude,
            longitude: view.position.longitude,
            speedKmh: view.position.speedKmh,
            heading: view.position.heading,
            recordedAt: view.position.recordedAt,
          })
        : null,
    };
  }
}

function routeEta(eta: RouteStopEta): RouteEtaDto {
  return { routeId: eta.routeId, plannedArrival: eta.plannedArrival.toISOString() };
}

/**
 * The anonymous view served by the public tracking endpoint: statuses and
 * timestamps, an ETA, and the driver's position only while the shipment is
 * out for delivery. No addresses, no people, no failure reasons.
 */
export class PublicTrackingResponseDto {
  @ApiProperty()
  trackingNumber: string;

  @ApiProperty()
  status: string;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        occurredAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  timeline: ReadonlyArray<{ status: string; occurredAt: string }>;

  @ApiProperty({ nullable: true, format: 'date-time' })
  eta: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Live driver position, present only while out for delivery.',
  })
  position: { latitude: number; longitude: number; recordedAt: string } | null;

  static from(view: PublicTrackingView): PublicTrackingResponseDto {
    return {
      trackingNumber: view.trackingNumber,
      status: view.status,
      timeline: view.timeline.map((entry) => ({
        status: entry.status,
        occurredAt: entry.occurredAt.toISOString(),
      })),
      eta: view.eta ? view.eta.toISOString() : null,
      position: view.position
        ? {
            latitude: view.position.latitude,
            longitude: view.position.longitude,
            recordedAt: view.position.recordedAt.toISOString(),
          }
        : null,
    };
  }
}
