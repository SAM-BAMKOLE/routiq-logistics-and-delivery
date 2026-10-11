import { ApiProperty } from '@nestjs/swagger';
import { ASSIGNMENT_STATUSES } from '../../domain/assignment.js';
import type { Assignment } from '../../domain/assignment.js';
import type { AssignmentStatus } from '../../domain/assignment.js';
import type { RankedCandidate } from '../../domain/dispatch-candidate.js';

export class AssignmentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  shipmentId: string;

  @ApiProperty({ format: 'uuid' })
  driverId: string;

  @ApiProperty({ nullable: true, format: 'uuid' })
  vehicleId: string | null;

  @ApiProperty({ enum: ASSIGNMENT_STATUSES })
  status: AssignmentStatus;

  @ApiProperty({ format: 'date-time' })
  offeredAt: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When the offer expires and is lazily expired.',
  })
  expiresAt: string;

  @ApiProperty({ nullable: true, format: 'date-time' })
  respondedAt: string | null;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  static from(assignment: Assignment): AssignmentResponseDto {
    return {
      id: assignment.id,
      shipmentId: assignment.shipmentId,
      driverId: assignment.driverId,
      vehicleId: assignment.vehicleId,
      status: assignment.status,
      offeredAt: assignment.offeredAt.toISOString(),
      expiresAt: assignment.expiresAt.toISOString(),
      respondedAt: assignment.respondedAt
        ? assignment.respondedAt.toISOString()
        : null,
      reason: assignment.reason,
      createdAt: assignment.createdAt.toISOString(),
      updatedAt: assignment.updatedAt.toISOString(),
    };
  }
}

export class AssignmentListResponseDto {
  @ApiProperty({ type: [AssignmentResponseDto] })
  data: AssignmentResponseDto[];
}

export class DispatchCandidateResponseDto {
  @ApiProperty({ format: 'uuid' })
  driverId: string;

  @ApiProperty({ format: 'uuid' })
  membershipId: string;

  @ApiProperty({
    nullable: true,
    format: 'uuid',
    description: 'Suggested vehicle: the driver’s own when it fits, else the smallest free fit.',
  })
  vehicleId: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Straight-line metres to the pickup; null when the driver has no known position.',
  })
  distanceMeters: number | null;

  @ApiProperty({ description: 'Live assignments the driver already holds.' })
  activeAssignments: number;

  @ApiProperty({
    nullable: true,
    description: 'Spare capacity of the suggestion: 0 is an exact fit.',
  })
  capacitySlack: number | null;

  @ApiProperty({
    description: 'Whether the candidate sits inside the tenant’s proximity radius pool.',
  })
  withinRadius: boolean;

  static from(candidate: RankedCandidate): DispatchCandidateResponseDto {
    return {
      driverId: candidate.driverId,
      membershipId: candidate.membershipId,
      vehicleId: candidate.vehicleId,
      distanceMeters:
        candidate.distanceMeters === null
          ? null
          : Math.round(candidate.distanceMeters),
      activeAssignments: candidate.activeAssignments,
      capacitySlack: candidate.capacitySlack,
      withinRadius: candidate.withinRadius,
    };
  }
}

export class DispatchCandidateListResponseDto {
  @ApiProperty({ type: [DispatchCandidateResponseDto] })
  data: DispatchCandidateResponseDto[];
}
