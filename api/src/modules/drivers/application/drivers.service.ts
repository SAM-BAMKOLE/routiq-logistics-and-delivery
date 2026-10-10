import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { VehiclesService } from '../../fleet/application/vehicles.service.js';
import type {
  MembershipRepository,
} from '../../identity/domain/membership.repository.js';
import { MEMBERSHIP_REPOSITORY as MEMBERSHIP_TOKEN } from '../../identity/domain/membership.repository.js';
import type {
  CreateDriverInput,
  CreateShiftInput,
  Driver,
  DriverAvailability,
  DriverShift,
  UpdateDriverInput,
} from '../domain/driver.js';
import {
  DRIVER_REPOSITORY,
  SHIFT_REPOSITORY,
  type DriverRepository,
  type ShiftRepository,
} from '../domain/driver.repository.js';

/**
 * Application service for drivers and their shifts. Memberships and vehicles
 * referenced by a driver are verified to belong to the same tenant — the RLS
 * scoping already guarantees this for reads, and the explicit checks turn a
 * cross-tenant id into a 404 instead of a foreign-key error.
 */
@Injectable()
export class DriversService {
  constructor(
    @Inject(DRIVER_REPOSITORY) private readonly drivers: DriverRepository,
    @Inject(SHIFT_REPOSITORY) private readonly shifts: ShiftRepository,
    @Inject(MEMBERSHIP_TOKEN)
    private readonly memberships: MembershipRepository,
    private readonly vehicles: VehiclesService,
  ) {}

  async createDriver(
    tenantId: string,
    input: CreateDriverInput,
  ): Promise<Driver> {
    await this.requireMembership(tenantId, input.membershipId);
    if (input.currentVehicleId) {
      await this.vehicles.getById(tenantId, input.currentVehicleId);
    }
    try {
      return await this.drivers.create({ ...input, tenantId });
    } catch (error) {
      throw mapDriverConflict(error, input.licenseNo);
    }
  }

  listDrivers(tenantId: string): Promise<Driver[]> {
    return this.drivers.listByTenant(tenantId);
  }

  async getDriver(tenantId: string, id: string): Promise<Driver> {
    const driver = await this.drivers.findById(id);
    if (!driver || driver.tenantId !== tenantId) {
      throw driverNotFound(id);
    }
    return driver;
  }

  async updateDriver(
    tenantId: string,
    id: string,
    changes: UpdateDriverInput,
  ): Promise<Driver> {
    const driver = await this.getDriver(tenantId, id);
    if (
      changes.licenseNo &&
      changes.licenseNo !== driver.licenseNo &&
      (await this.drivers.findByLicense(tenantId, changes.licenseNo))
    ) {
      throw licenseTaken(changes.licenseNo);
    }
    if (changes.currentVehicleId) {
      await this.vehicles.getById(tenantId, changes.currentVehicleId);
    }
    try {
      const updated = await this.drivers.update(id, changes);
      if (!updated) {
        throw driverNotFound(id);
      }
      return updated;
    } catch (error) {
      throw mapDriverConflict(error, changes.licenseNo ?? driver.licenseNo);
    }
  }

  async removeDriver(tenantId: string, id: string): Promise<void> {
    await this.getDriver(tenantId, id);
    await this.drivers.remove(id);
  }

  /**
   * Dispatcher-facing availability change for any driver of the tenant.
   * Self-service goes through {@link setOwnAvailability}.
   */
  async setAvailability(
    tenantId: string,
    id: string,
    availability: DriverAvailability,
  ): Promise<Driver> {
    const driver = await this.getDriver(tenantId, id);
    const updated = await this.drivers.update(driver.id, { availability });
    if (!updated) {
      throw driverNotFound(id);
    }
    return updated;
  }

  /** Resolves the caller's own driver profile from their membership. */
  async setOwnAvailability(
    tenantId: string,
    userId: string,
    availability: DriverAvailability,
  ): Promise<Driver> {
    const membership = await this.memberships.findByTenantAndUser(
      tenantId,
      userId,
    );
    const driver =
      membership &&
      (await this.drivers.findByMembership(tenantId, membership.id));
    if (!driver) {
      throw new NotFoundException({
        message: 'This user has no driver profile in this tenant.',
        code: 'DRIVER_PROFILE_NOT_FOUND',
      });
    }
    const updated = await this.drivers.update(driver.id, { availability });
    if (!updated) {
      throw driverNotFound(driver.id);
    }
    return updated;
  }

  async createShift(
    tenantId: string,
    driverId: string,
    input: CreateShiftInput,
  ): Promise<DriverShift> {
    await this.getDriver(tenantId, driverId);
    if (input.endsAt.getTime() <= input.startsAt.getTime()) {
      throw new UnprocessableEntityException({
        message: 'A shift must end after it starts.',
        code: 'SHIFT_END_BEFORE_START',
      });
    }
    return this.shifts.create({ ...input, tenantId, driverId });
  }

  async listShifts(tenantId: string, driverId: string): Promise<DriverShift[]> {
    await this.getDriver(tenantId, driverId);
    const shifts = await this.shifts.listByDriver(driverId);
    return shifts.filter((shift) => shift.tenantId === tenantId);
  }

  async removeShift(
    tenantId: string,
    driverId: string,
    shiftId: string,
  ): Promise<void> {
    await this.getDriver(tenantId, driverId);
    const shift = await this.shifts.findById(shiftId);
    if (!shift || shift.tenantId !== tenantId || shift.driverId !== driverId) {
      throw shiftNotFound(shiftId);
    }
    await this.shifts.remove(shiftId);
  }

  private async requireMembership(
    tenantId: string,
    membershipId: string,
  ): Promise<void> {
    const membership = await this.memberships.findById(membershipId);
    if (!membership || membership.tenantId !== tenantId) {
      throw new NotFoundException({
        message: `Membership ${membershipId} was not found in this tenant.`,
        code: 'MEMBERSHIP_NOT_FOUND',
      });
    }
  }
}

function driverNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Driver ${id} was not found in this tenant.`,
    code: 'DRIVER_NOT_FOUND',
  });
}

function licenseTaken(licenseNo: string): ConflictException {
  return new ConflictException({
    message: `License number "${licenseNo}" is already registered in this tenant.`,
    code: 'LICENSE_TAKEN',
  });
}

function shiftNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Shift ${id} was not found for this driver.`,
    code: 'SHIFT_NOT_FOUND',
  });
}

/**
 * Maps a unique violation to the offending constraint. Postgres names the
 * constraint on `driverError`, so a duplicate profile and a duplicate license
 * get distinct codes instead of one generic 409.
 */
function mapDriverConflict(error: unknown, licenseNo: string): Error {
  if (typeof error === 'object' && error !== null) {
    const driverError = (
      error as { driverError?: { code?: string; constraint?: string } }
    ).driverError;
    if (driverError?.code === '23505') {
      if (driverError.constraint === 'uq_drivers_tenant_license') {
        return licenseTaken(licenseNo);
      }
      return new ConflictException({
        message: 'This membership already has a driver profile in this tenant.',
        code: 'DRIVER_EXISTS',
      });
    }
  }
  return error as Error;
}
