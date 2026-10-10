import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateVehicleInput,
  UpdateVehicleInput,
  Vehicle,
} from '../domain/vehicle.js';
import {
  VEHICLE_REPOSITORY,
  type VehicleRepository,
} from '../domain/vehicle.repository.js';

/**
 * Application service for fleet vehicles. Plates are unique per tenant; the
 * pre-check gives a friendly 409 and the composite unique constraint is the
 * backstop for races.
 */
@Injectable()
export class VehiclesService {
  constructor(
    @Inject(VEHICLE_REPOSITORY) private readonly vehicles: VehicleRepository,
  ) {}

  async create(input: CreateVehicleInput): Promise<Vehicle> {
    if (await this.vehicles.findByPlate(input.tenantId, input.plate)) {
      throw plateTaken(input.plate);
    }
    try {
      return await this.vehicles.create(input);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw plateTaken(input.plate);
      }
      throw error;
    }
  }

  list(tenantId: string): Promise<Vehicle[]> {
    return this.vehicles.listByTenant(tenantId);
  }

  async getById(tenantId: string, id: string): Promise<Vehicle> {
    const vehicle = await this.vehicles.findById(id);
    if (!vehicle || vehicle.tenantId !== tenantId) {
      throw vehicleNotFound(id);
    }
    return vehicle;
  }

  async update(
    tenantId: string,
    id: string,
    changes: UpdateVehicleInput,
  ): Promise<Vehicle> {
    const vehicle = await this.vehicles.findById(id);
    if (!vehicle || vehicle.tenantId !== tenantId) {
      throw vehicleNotFound(id);
    }
    if (changes.plate && changes.plate !== vehicle.plate) {
      const taken = await this.vehicles.findByPlate(tenantId, changes.plate);
      if (taken) {
        throw plateTaken(changes.plate);
      }
    }
    try {
      const updated = await this.vehicles.update(id, changes);
      if (!updated) {
        throw vehicleNotFound(id);
      }
      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw plateTaken(changes.plate ?? vehicle.plate);
      }
      throw error;
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const vehicle = await this.vehicles.findById(id);
    if (!vehicle || vehicle.tenantId !== tenantId) {
      throw vehicleNotFound(id);
    }
    await this.vehicles.remove(id);
  }
}

function plateTaken(plate: string): ConflictException {
  return new ConflictException({
    message: `A vehicle with plate "${plate}" already exists in this tenant.`,
    code: 'VEHICLE_PLATE_TAKEN',
  });
}

function vehicleNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Vehicle ${id} was not found in this tenant.`,
    code: 'VEHICLE_NOT_FOUND',
  });
}

/** Postgres unique-violation. TypeORM surfaces the driver error on `driverError`. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const driverError = (error as { driverError?: { code?: string } }).driverError;
  return driverError?.code === '23505';
}
