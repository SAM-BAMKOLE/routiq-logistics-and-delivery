import type {
  CreateDriverInput,
  CreateShiftInput,
  Driver,
  DriverShift,
  UpdateDriverInput,
} from './driver.js';

/** DI token for the {@link DriverRepository} port. */
export const DRIVER_REPOSITORY = Symbol('DRIVER_REPOSITORY');

/** DI token for the {@link ShiftRepository} port. */
export const SHIFT_REPOSITORY = Symbol('SHIFT_REPOSITORY');

/** Outbound port for driver persistence (tenant-scoped via RLS). */
export interface DriverRepository {
  create(input: CreateDriverInput & { tenantId: string }): Promise<Driver>;
  findById(id: string): Promise<Driver | null>;
  findByMembership(tenantId: string, membershipId: string): Promise<Driver | null>;
  findByLicense(tenantId: string, licenseNo: string): Promise<Driver | null>;
  listByTenant(tenantId: string): Promise<Driver[]>;
  update(id: string, changes: UpdateDriverInput): Promise<Driver | null>;
  remove(id: string): Promise<boolean>;
}

/** Outbound port for shift persistence (tenant-scoped via RLS). */
export interface ShiftRepository {
  create(
    input: CreateShiftInput & { tenantId: string; driverId: string },
  ): Promise<DriverShift>;
  findById(id: string): Promise<DriverShift | null>;
  listByDriver(driverId: string): Promise<DriverShift[]>;
  remove(id: string): Promise<boolean>;
}
