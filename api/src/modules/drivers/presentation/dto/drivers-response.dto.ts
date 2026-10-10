import { ApiProperty } from '@nestjs/swagger';
import {
  DRIVER_AVAILABILITY,
  DRIVER_STATUSES,
} from '../../domain/driver.js';
import type {
  Driver,
  DriverAvailability,
  DriverShift,
  DriverStatus,
} from '../../domain/driver.js';

export class DriverResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  membershipId: string;

  @ApiProperty()
  licenseNo: string;

  @ApiProperty({ enum: DRIVER_STATUSES })
  status: DriverStatus;

  @ApiProperty({ enum: DRIVER_AVAILABILITY })
  availability: DriverAvailability;

  @ApiProperty({ format: 'uuid', nullable: true })
  currentVehicleId: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  static from(driver: Driver): DriverResponseDto {
    return {
      id: driver.id,
      membershipId: driver.membershipId,
      licenseNo: driver.licenseNo,
      status: driver.status,
      availability: driver.availability,
      currentVehicleId: driver.currentVehicleId,
      createdAt: driver.createdAt.toISOString(),
      updatedAt: driver.updatedAt.toISOString(),
    };
  }
}

export class DriverListResponseDto {
  @ApiProperty({ type: [DriverResponseDto] })
  data: DriverResponseDto[];
}

export class ShiftResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  driverId: string;

  @ApiProperty({ format: 'date-time' })
  startsAt: string;

  @ApiProperty({ format: 'date-time' })
  endsAt: string;

  static from(shift: DriverShift): ShiftResponseDto {
    return {
      id: shift.id,
      driverId: shift.driverId,
      startsAt: shift.startsAt.toISOString(),
      endsAt: shift.endsAt.toISOString(),
    };
  }
}

export class ShiftListResponseDto {
  @ApiProperty({ type: [ShiftResponseDto] })
  data: ShiftResponseDto[];
}
