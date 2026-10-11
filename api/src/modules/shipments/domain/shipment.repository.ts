import type { Shipment } from './shipment.js';
import type { ShipmentStatus } from './shipment-status.js';

/** DI token for the {@link ShipmentRepository} port. */
export const SHIPMENT_REPOSITORY = Symbol('SHIPMENT_REPOSITORY');

/** DI token for the {@link ShipmentHistoryRepository} port. */
export const SHIPMENT_HISTORY_REPOSITORY = Symbol('SHIPMENT_HISTORY_REPOSITORY');

/** Whitelisted list filters (validated again in the DTO layer). */
export interface ShipmentListFilters {
  status?: ShipmentStatus;
  customerId?: string;
  /** Driver profile id; drivers list exactly their own shipments. */
  driverId?: string;
}

/**
 * Outbound port for the shipment aggregate (tenant-scoped via RLS). The
 * repository maps the aggregate to its three tables; status changes always
 * go through the aggregate, never through a bare column write.
 */
export interface ShipmentRepository {
  /** Inserts a fresh aggregate together with its items. */
  insert(shipment: Shipment): Promise<void>;
  /** Persists the aggregate's current state after a transition. */
  save(shipment: Shipment): Promise<void>;
  findById(id: string): Promise<Shipment | null>;
  listByTenant(
    tenantId: string,
    filters?: ShipmentListFilters,
  ): Promise<Shipment[]>;
}

/** A history row: who moved the shipment, from where to where, and why. */
export interface ShipmentHistoryEntry {
  readonly tenantId: string;
  readonly shipmentId: string;
  readonly fromStatus: ShipmentStatus | null;
  readonly toStatus: ShipmentStatus;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly occurredAt: Date;
}

/** Append-only history port. Rows are never updated or deleted. */
export interface ShipmentHistoryRepository {
  append(entries: readonly ShipmentHistoryEntry[]): Promise<void>;
}
