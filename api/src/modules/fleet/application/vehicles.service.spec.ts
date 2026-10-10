import { ConflictException, NotFoundException } from '@nestjs/common';
import type {
  CreateVehicleInput,
  UpdateVehicleInput,
  Vehicle,
} from '../domain/vehicle.js';
import type { VehicleRepository } from '../domain/vehicle.repository.js';
import { VehiclesService } from './vehicles.service.js';

function vehicleFixture(id: string, tenantId: string, plate: string): Vehicle {
  return {
    id,
    tenantId,
    plate,
    type: 'van',
    capacityWeightKg: 1500,
    capacityVolumeM3: 12,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface Harness {
  service: VehiclesService;
  vehicles: Map<string, Vehicle>;
}

function makeHarness(): Harness {
  const vehicles = new Map<string, Vehicle>();
  let seq = 0;

  const repository: VehicleRepository = {
    create: async (input: CreateVehicleInput & { tenantId: string }) => {
      if (
        [...vehicles.values()].some(
          (v) => v.tenantId === input.tenantId && v.plate === input.plate,
        )
      ) {
        throw { driverError: { code: '23505' } };
      }
      const vehicle: Vehicle = {
        ...vehicleFixture(`v-${++seq}`, input.tenantId, input.plate),
        type: input.type,
        capacityWeightKg: input.capacityWeightKg,
        capacityVolumeM3: input.capacityVolumeM3,
        status: input.status ?? 'active',
      };
      vehicles.set(vehicle.id, vehicle);
      return vehicle;
    },
    findById: async (id) => vehicles.get(id) ?? null,
    findByPlate: async (tenantId, plate) =>
      [...vehicles.values()].find(
        (v) => v.tenantId === tenantId && v.plate === plate,
      ) ?? null,
    listByTenant: async (tenantId) =>
      [...vehicles.values()].filter((v) => v.tenantId === tenantId),
    update: async (id, changes: UpdateVehicleInput) => {
      const current = vehicles.get(id);
      if (!current) return null;
      if (
        changes.plate &&
        [...vehicles.values()].some(
          (v) => v.id !== id && v.tenantId === current.tenantId && v.plate === changes.plate,
        )
      ) {
        throw { driverError: { code: '23505' } };
      }
      const updated: Vehicle = { ...current, ...changes };
      vehicles.set(id, updated);
      return updated;
    },
    remove: async (id) => vehicles.delete(id),
  };

  return { service: new VehiclesService(repository), vehicles };
}

describe('VehiclesService', () => {
  it('creates vehicles and rejects duplicate plates per tenant', async () => {
    const h = makeHarness();
    const created = await h.service.create({
      tenantId: 't-1',
      plate: 'KTU-1',
      type: 'van',
      capacityWeightKg: 1000,
      capacityVolumeM3: 10,
    });
    expect(created.plate).toBe('KTU-1');

    await expect(
      h.service.create({
        tenantId: 't-1',
        plate: 'KTU-1',
        type: 'truck',
        capacityWeightKg: 5000,
        capacityVolumeM3: 30,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Same plate in another tenant is fine.
    const other = await h.service.create({
      tenantId: 't-2',
      plate: 'KTU-1',
      type: 'van',
      capacityWeightKg: 1000,
      capacityVolumeM3: 10,
    });
    expect(other.tenantId).toBe('t-2');
  });

  it('reads, updates, and removes within the tenant', async () => {
    const h = makeHarness();
    const created = await h.service.create({
      tenantId: 't-1',
      plate: 'KTU-1',
      type: 'van',
      capacityWeightKg: 1000,
      capacityVolumeM3: 10,
    });

    expect(await h.service.getById('t-1', created.id)).toEqual(created);
    await expect(h.service.getById('t-2', created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const updated = await h.service.update('t-1', created.id, {
      status: 'in_maintenance',
    });
    expect(updated.status).toBe('in_maintenance');

    await h.service.remove('t-1', created.id);
    expect(await h.service.list('t-1')).toHaveLength(0);
  });

  it('rejects plate changes that collide', async () => {
    const h = makeHarness();
    const base = {
      tenantId: 't-1',
      type: 'van' as const,
      capacityWeightKg: 1000,
      capacityVolumeM3: 10,
    };
    const first = await h.service.create({ ...base, plate: 'KTU-1' });
    await h.service.create({ ...base, plate: 'KTU-2' });

    await expect(
      h.service.update('t-1', first.id, { plate: 'KTU-2' }),
    ).rejects.toMatchObject({ response: { code: 'VEHICLE_PLATE_TAKEN' } });
  });
});
