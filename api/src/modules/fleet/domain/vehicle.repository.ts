import type {
  CreateVehicleInput,
  UpdateVehicleInput,
  Vehicle,
} from './vehicle.js';

/** DI token for the {@link VehicleRepository} port. */
export const VEHICLE_REPOSITORY = Symbol('VEHICLE_REPOSITORY');

/** Outbound port for vehicle persistence (tenant-scoped via RLS). */
export interface VehicleRepository {
  create(input: CreateVehicleInput): Promise<Vehicle>;
  findById(id: string): Promise<Vehicle | null>;
  findByPlate(tenantId: string, plate: string): Promise<Vehicle | null>;
  listByTenant(tenantId: string): Promise<Vehicle[]>;
  update(id: string, changes: UpdateVehicleInput): Promise<Vehicle | null>;
  remove(id: string): Promise<boolean>;
}
