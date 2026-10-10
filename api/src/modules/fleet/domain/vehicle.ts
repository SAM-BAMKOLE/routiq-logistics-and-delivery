/**
 * A fleet vehicle in domain terms. `type` and `status` arrive as free text
 * from the database and are narrowed to their unions at the boundary.
 */
export const VEHICLE_TYPES = [
  'motorbike',
  'van',
  'truck',
  'refrigerated_truck',
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_STATUSES = ['active', 'in_maintenance', 'retired'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export interface Vehicle {
  readonly id: string;
  readonly tenantId: string;
  readonly plate: string;
  readonly type: VehicleType;
  readonly capacityWeightKg: number;
  readonly capacityVolumeM3: number;
  readonly status: VehicleStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateVehicleInput {
  tenantId: string;
  plate: string;
  type: VehicleType;
  capacityWeightKg: number;
  capacityVolumeM3: number;
  status?: VehicleStatus;
}

export interface UpdateVehicleInput {
  plate?: string;
  type?: VehicleType;
  capacityWeightKg?: number;
  capacityVolumeM3?: number;
  status?: VehicleStatus;
}
