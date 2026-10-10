/**
 * A driver profile in domain terms: an operational record hung off a
 * membership. `status` is admin-managed; `availability` is the manual flag
 * the driver (or a dispatcher) flips. Shifts live in their own aggregate and
 * will drive computed availability in dispatch.
 */
export const DRIVER_STATUSES = ['active', 'suspended'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DRIVER_AVAILABILITY = ['available', 'unavailable'] as const;
export type DriverAvailability = (typeof DRIVER_AVAILABILITY)[number];

export interface Driver {
  readonly id: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly licenseNo: string;
  readonly status: DriverStatus;
  readonly availability: DriverAvailability;
  readonly currentVehicleId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateDriverInput {
  membershipId: string;
  licenseNo: string;
  status?: DriverStatus;
  currentVehicleId?: string | null;
}

export interface UpdateDriverInput {
  licenseNo?: string;
  status?: DriverStatus;
  availability?: DriverAvailability;
  currentVehicleId?: string | null;
}

export interface DriverShift {
  readonly id: string;
  readonly tenantId: string;
  readonly driverId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateShiftInput {
  startsAt: Date;
  endsAt: Date;
}
