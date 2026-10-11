import type { Assignment } from './assignment.js';

/** DI token for the {@link AssignmentRepository} port. */
export const ASSIGNMENT_REPOSITORY = Symbol('ASSIGNMENT_REPOSITORY');

/** Inputs of the candidate search (see {@link AssignmentRepository}). */
export interface CandidateSearchInput {
  readonly tenantId: string;
  /** Pickup address whose coordinates proximity ranks against. */
  readonly pickupAddressId: string;
  readonly weightKg: number;
  readonly volumeM3: number | null;
}

/**
 * A ranked suggestion row from the candidate search: an eligible driver, how
 * far they are from the pickup when their last position is known, how loaded
 * they already are, and the vehicle dispatch suggests for the job.
 */
export interface DispatchCandidate {
  readonly driverId: string;
  readonly membershipId: string;
  /** Suggested vehicle: the driver's own when it fits, else the smallest free fit. */
  readonly vehicleId: string | null;
  /** Straight-line metres to the pickup, or null when no position is known. */
  readonly distanceMeters: number | null;
  /** Live (offered or accepted) assignments the driver already holds. */
  readonly activeAssignments: number;
  /** Spare capacity of the suggestion, 0 (exact fit) to 1; null without a vehicle. */
  readonly capacitySlack: number | null;
}

/**
 * Outbound port for the assignment lifecycle (tenant-scoped via RLS). The
 * repository owns two duties beyond CRUD: the raw spatial candidate search
 * (PostGIS distance, eligibility filters) and the lazy offer expiry that the
 * phase-2 timeout job will replace.
 */
export interface AssignmentRepository {
  insert(assignment: Assignment): Promise<void>;
  /** Persists the aggregate's current state after a transition. */
  save(assignment: Assignment): Promise<void>;
  findById(id: string): Promise<Assignment | null>;
  /** The driver's assignments, newest offers first. */
  listByDriver(driverId: string): Promise<Assignment[]>;
  /** Every offer in the tenant whose TTL has passed, still as `offered`
   * aggregates — the caller expires, saves, and publishes each one. */
  findOverdue(tenantId: string, now: Date): Promise<Assignment[]>;
  /**
   * The raw candidate pool: active, available drivers with no live
   * assignment, on shift or without a schedule, whose tenant has a free
   * vehicle that fits the shipment's weight and volume. Includes each
   * driver's distance to the pickup (null when no position is known), their
   * live-assignment load, and a suggested vehicle.
   */
  searchCandidates(input: CandidateSearchInput): Promise<DispatchCandidate[]>;
}
