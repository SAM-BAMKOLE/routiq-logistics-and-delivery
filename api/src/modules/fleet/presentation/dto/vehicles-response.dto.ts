import { ApiProperty } from '@nestjs/swagger';
import { VEHICLE_STATUSES, VEHICLE_TYPES } from '../../domain/vehicle.js';
import type { Vehicle, VehicleStatus, VehicleType } from '../../domain/vehicle.js';

export class VehicleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  plate: string;

  @ApiProperty({ enum: VEHICLE_TYPES })
  type: VehicleType;

  @ApiProperty()
  capacityWeightKg: number;

  @ApiProperty()
  capacityVolumeM3: number;

  @ApiProperty({ enum: VEHICLE_STATUSES })
  status: VehicleStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  static from(vehicle: Vehicle): VehicleResponseDto {
    return {
      id: vehicle.id,
      plate: vehicle.plate,
      type: vehicle.type,
      capacityWeightKg: vehicle.capacityWeightKg,
      capacityVolumeM3: vehicle.capacityVolumeM3,
      status: vehicle.status,
      createdAt: vehicle.createdAt.toISOString(),
      updatedAt: vehicle.updatedAt.toISOString(),
    };
  }
}

export class VehicleListResponseDto {
  @ApiProperty({ type: [VehicleResponseDto] })
  data: VehicleResponseDto[];
}
