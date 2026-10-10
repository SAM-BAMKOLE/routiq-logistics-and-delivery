import { NotFoundException } from '@nestjs/common';
import type { VehiclesService } from '../../fleet/application/vehicles.service.js';
import type { MembershipRepository } from '../../identity/domain/membership.repository.js';
import type {
  CreateDriverInput,
  CreateShiftInput,
  Driver,
  DriverShift,
  UpdateDriverInput,
} from '../domain/driver.js';
import type {
  DriverRepository,
  ShiftRepository,
} from '../domain/driver.repository.js';
import { DriversService } from './drivers.service.js';

function driverFixture(
  id: string,
  tenantId: string,
  membershipId: string,
  licenseNo: string,
): Driver {
  return {
    id,
    tenantId,
    membershipId,
    licenseNo,
    status: 'active',
    availability: 'available',
    currentVehicleId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface Harness {
  service: DriversService;
  drivers: Map<string, Driver>;
  shifts: Map<string, DriverShift>;
}

function makeHarness(): Harness {
  const drivers = new Map<string, Driver>();
  const shifts = new Map<string, DriverShift>();
  let seq = 0;

  const driverRepository: DriverRepository = {
    create: async (input: CreateDriverInput & { tenantId: string }) => {
      if (
        [...drivers.values()].some(
          (d) =>
            d.tenantId === input.tenantId && d.membershipId === input.membershipId,
        )
      ) {
        throw {
          driverError: { code: '23505', constraint: 'uq_drivers_tenant_membership' },
        };
      }
      if (
        [...drivers.values()].some(
          (d) => d.tenantId === input.tenantId && d.licenseNo === input.licenseNo,
        )
      ) {
        throw {
          driverError: { code: '23505', constraint: 'uq_drivers_tenant_license' },
        };
      }
      const driver: Driver = {
        ...driverFixture(`d-${++seq}`, input.tenantId, input.membershipId, input.licenseNo),
        status: input.status ?? 'active',
        currentVehicleId: input.currentVehicleId ?? null,
      };
      drivers.set(driver.id, driver);
      return driver;
    },
    findById: async (id) => drivers.get(id) ?? null,
    findByMembership: async (tenantId, membershipId) =>
      [...drivers.values()].find(
        (d) => d.tenantId === tenantId && d.membershipId === membershipId,
      ) ?? null,
    findByLicense: async (tenantId, licenseNo) =>
      [...drivers.values()].find(
        (d) => d.tenantId === tenantId && d.licenseNo === licenseNo,
      ) ?? null,
    listByTenant: async (tenantId) =>
      [...drivers.values()].filter((d) => d.tenantId === tenantId),
    update: async (id, changes: UpdateDriverInput) => {
      const current = drivers.get(id);
      if (!current) return null;
      const updated: Driver = { ...current, ...changes };
      drivers.set(id, updated);
      return updated;
    },
    remove: async (id) => drivers.delete(id),
  };

  const shiftRepository: ShiftRepository = {
    create: async (input) => {
      const shift: DriverShift = {
        id: `s-${++seq}`,
        tenantId: input.tenantId,
        driverId: input.driverId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      shifts.set(shift.id, shift);
      return shift;
    },
    findById: async (id) => shifts.get(id) ?? null,
    listByDriver: async (driverId) =>
      [...shifts.values()].filter((s) => s.driverId === driverId),
    remove: async (id) => shifts.delete(id),
  };

  const memberships = {
    findById: async (id: string) =>
      id === 'm-1' || id === 'm-2'
        ? {
            id,
            tenantId: 't-1',
            userId: id === 'm-1' ? 'u-1' : 'u-2',
            role: 'driver',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null,
    findByTenantAndUser: async (tenantId: string, userId: string) =>
      tenantId === 't-1' && userId === 'u-1'
        ? {
            id: 'm-1',
            tenantId: 't-1',
            userId: 'u-1',
            role: 'driver',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null,
  } as unknown as MembershipRepository;

  const vehicles = {
    getById: async (tenantId: string, id: string) => {
      if (id === 'missing-vehicle' || tenantId !== 't-1') {
        const error = new NotFoundException({
          message: `Vehicle ${id} was not found in this tenant.`,
          code: 'VEHICLE_NOT_FOUND',
        });
        throw error;
      }
      return {
        id,
        tenantId,
        plate: 'KTU-1',
        type: 'van',
        capacityWeightKg: 1000,
        capacityVolumeM3: 10,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
  } as unknown as VehiclesService;

  return {
    service: new DriversService(
      driverRepository,
      shiftRepository,
      memberships,
      vehicles,
    ),
    drivers,
    shifts,
  };
}

describe('DriversService', () => {
  it('creates a driver for a membership of the same tenant', async () => {
    const h = makeHarness();
    const driver = await h.service.createDriver('t-1', {
      membershipId: 'm-1',
      licenseNo: 'DL-1',
    });

    expect(driver.tenantId).toBe('t-1');
    expect(driver.availability).toBe('available');
  });

  it('rejects foreign memberships, duplicate profiles, and duplicate licenses', async () => {
    const h = makeHarness();
    await expect(
      h.service.createDriver('t-1', { membershipId: 'm-9', licenseNo: 'DL-1' }),
    ).rejects.toMatchObject({ response: { code: 'MEMBERSHIP_NOT_FOUND' } });

    await h.service.createDriver('t-1', { membershipId: 'm-1', licenseNo: 'DL-1' });
    await expect(
      h.service.createDriver('t-1', { membershipId: 'm-1', licenseNo: 'DL-2' }),
    ).rejects.toMatchObject({ response: { code: 'DRIVER_EXISTS' } });
  });

  it('rejects unknown vehicles on create and update', async () => {
    const h = makeHarness();
    await expect(
      h.service.createDriver('t-1', {
        membershipId: 'm-1',
        licenseNo: 'DL-1',
        currentVehicleId: 'missing-vehicle',
      }),
    ).rejects.toMatchObject({ response: { code: 'VEHICLE_NOT_FOUND' } });
  });

  it('resolves the caller’s own profile for self-service availability', async () => {
    const h = makeHarness();
    await h.service.createDriver('t-1', { membershipId: 'm-1', licenseNo: 'DL-1' });

    const updated = await h.service.setOwnAvailability('t-1', 'u-1', 'unavailable');
    expect(updated.availability).toBe('unavailable');

    await expect(
      h.service.setOwnAvailability('t-1', 'u-9', 'available'),
    ).rejects.toMatchObject({ response: { code: 'DRIVER_PROFILE_NOT_FOUND' } });
  });

  it('validates shift ranges and scopes shifts to their driver', async () => {
    const h = makeHarness();
    const driver = await h.service.createDriver('t-1', {
      membershipId: 'm-1',
      licenseNo: 'DL-1',
    });

    await expect(
      h.service.createShift('t-1', driver.id, {
        startsAt: new Date('2026-10-12T14:00:00Z'),
        endsAt: new Date('2026-10-12T06:00:00Z'),
      } as CreateShiftInput),
    ).rejects.toMatchObject({ response: { code: 'SHIFT_END_BEFORE_START' } });

    const shift = await h.service.createShift('t-1', driver.id, {
      startsAt: new Date('2026-10-12T06:00:00Z'),
      endsAt: new Date('2026-10-12T14:00:00Z'),
    } as CreateShiftInput);
    expect(await h.service.listShifts('t-1', driver.id)).toHaveLength(1);

    await h.service.removeShift('t-1', driver.id, shift.id);
    expect(await h.service.listShifts('t-1', driver.id)).toHaveLength(0);
  });

  it('returns 404 across tenants', async () => {
    const h = makeHarness();
    const driver = await h.service.createDriver('t-1', {
      membershipId: 'm-1',
      licenseNo: 'DL-1',
    });

    await expect(h.service.getDriver('t-2', driver.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      h.service.updateDriver('t-2', driver.id, { availability: 'unavailable' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps duplicate licenses distinctly from duplicate profiles', async () => {
    const h = makeHarness();
    await h.service.createDriver('t-1', { membershipId: 'm-1', licenseNo: 'DL-1' });

    await expect(
      h.service.createDriver('t-1', { membershipId: 'm-2', licenseNo: 'DL-1' }),
    ).rejects.toMatchObject({ response: { code: 'LICENSE_TAKEN' } });
  });
});
