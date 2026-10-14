import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Assignment, isAssignmentStatus } from '../domain/assignment.js';
import type {
  AssignmentRepository,
  CandidateSearchInput,
  DispatchCandidate,
} from '../domain/assignment.repository.js';
import { AssignmentOrmEntity } from './assignment.orm-entity.js';

/**
 * TypeORM implementation of the {@link AssignmentRepository} port. Besides
 * CRUD it owns the two queries that make dispatch work: the PostGIS
 * candidate search and the lazy-overdue scan. Everything runs inside the
 * tenant transaction, so RLS scopes every table the joins touch.
 */
@Injectable()
export class TypeOrmAssignmentRepository implements AssignmentRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async insert(assignment: Assignment): Promise<void> {
    await this.manager().insert(AssignmentOrmEntity, {
      // The aggregate owns the id: events all reference it.
      id: assignment.id,
      tenantId: assignment.tenantId,
      shipmentId: assignment.shipmentId,
      driverId: assignment.driverId,
      vehicleId: assignment.vehicleId,
      status: assignment.status,
      offeredAt: assignment.offeredAt,
      expiresAt: assignment.expiresAt,
      respondedAt: assignment.respondedAt,
      reason: assignment.reason,
    });
  }

  async save(assignment: Assignment): Promise<void> {
    await this.manager().update(
      AssignmentOrmEntity,
      { id: assignment.id },
      {
        status: assignment.status,
        respondedAt: assignment.respondedAt,
        reason: assignment.reason,
      },
    );
  }

  async findById(id: string): Promise<Assignment | null> {
    const entity = await this.manager().findOne(AssignmentOrmEntity, {
      where: { id },
    });
    return entity ? toDomain(entity) : null;
  }

  async findLiveByShipment(shipmentId: string): Promise<Assignment[]> {
    const entities = await this.manager()
      .getRepository(AssignmentOrmEntity)
      .createQueryBuilder('assignment')
      .where('assignment.shipment_id = :shipmentId', { shipmentId })
      .andWhere('assignment.status IN (:...statuses)', {
        statuses: ['offered', 'accepted'],
      })
      .getMany();
    return entities.map(toDomain);
  }

  async listByDriver(driverId: string): Promise<Assignment[]> {
    const entities = await this.manager().find(AssignmentOrmEntity, {
      where: { driverId },
      order: { offeredAt: 'DESC' },
    });
    return entities.map(toDomain);
  }

  async findOverdue(tenantId: string, now: Date): Promise<Assignment[]> {
    const entities = await this.manager()
      .getRepository(AssignmentOrmEntity)
      .createQueryBuilder('assignment')
      .where('assignment.tenant_id = :tenantId', { tenantId })
      .andWhere('assignment.status = :status', { status: 'offered' })
      .andWhere('assignment.expires_at <= :now', { now })
      .orderBy('assignment.expires_at', 'ASC')
      .getMany();
    return entities.map(toDomain);
  }

  /**
   * The candidate pool as one round trip. Shape of the query:
   *
   * - `pickup` joins the shipment's pickup address for the distance datum.
   * - `loc` is the driver's newest known position (Step 10 fills this table;
   *   until then every candidate is unlocated and proximity degrades to the
   *   strategy's load ranking, which is why distance is nullable).
   * - `own_fit` suggests the driver's own vehicle when it is active, fits the
   *   shipment's weight and volume, and is not already held by a live
   *   assignment; `free_fit` picks the smallest adequate vehicle nobody is
   *   driving right now.
   * - The WHERE clause is the eligibility filter: active and available, no
   *   live assignment, on shift or without a schedule, and at least one free
   *   vehicle in the tenant that fits. Distance and slack are computed but
   *   never filtered here — the radius widening is a tenant setting applied
   *   in the application layer, where the steps are data, not SQL.
   */
  async searchCandidates(
    input: CandidateSearchInput,
  ): Promise<DispatchCandidate[]> {
    const rows = (await this.manager().query(
      `
      SELECT
        d.id AS driver_id,
        d.membership_id AS membership_id,
        ST_Distance(loc.location, pickup.location) AS distance_m,
        (
          SELECT COUNT(*)
            FROM dispatch_assignments da
           WHERE da.driver_id = d.id
             AND da.status IN ('offered', 'accepted')
        )::int AS active_assignments,
        COALESCE(own_fit.id, free_fit.id) AS vehicle_id,
        COALESCE(own_fit.slack, free_fit.slack) AS capacity_slack
      FROM drivers d
      JOIN LATERAL (
        SELECT a.location FROM addresses a WHERE a.id = $2
      ) pickup ON TRUE
      LEFT JOIN LATERAL (
        SELECT dl.location
          FROM driver_locations dl
         WHERE dl.driver_id = d.id
         ORDER BY dl.recorded_at DESC
         LIMIT 1
      ) loc ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          v.id,
          LEAST(
            (v.capacity_weight_kg - $3::double precision) / v.capacity_weight_kg,
            CASE
              WHEN v.capacity_volume_m3 IS NOT NULL AND $4::double precision IS NOT NULL
                THEN (v.capacity_volume_m3 - $4::double precision) / v.capacity_volume_m3
              ELSE 1
            END
          ) AS slack
          FROM vehicles v
         WHERE v.id = d.current_vehicle_id
           AND v.status = 'active'
           AND v.capacity_weight_kg >= $3::double precision
           AND (
             v.capacity_volume_m3 IS NULL OR $4::double precision IS NULL
             OR v.capacity_volume_m3 >= $4::double precision
           )
           AND NOT EXISTS (
             SELECT 1 FROM dispatch_assignments da
              WHERE da.vehicle_id = v.id AND da.status IN ('offered', 'accepted')
           )
      ) own_fit ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          v.id,
          LEAST(
            (v.capacity_weight_kg - $3::double precision) / v.capacity_weight_kg,
            CASE
              WHEN v.capacity_volume_m3 IS NOT NULL AND $4::double precision IS NOT NULL
                THEN (v.capacity_volume_m3 - $4::double precision) / v.capacity_volume_m3
              ELSE 1
            END
          ) AS slack
          FROM vehicles v
         WHERE v.status = 'active'
           AND v.capacity_weight_kg >= $3::double precision
           AND (
             v.capacity_volume_m3 IS NULL OR $4::double precision IS NULL
             OR v.capacity_volume_m3 >= $4::double precision
           )
           AND v.id <> COALESCE(own_fit.id, '00000000-0000-0000-0000-000000000000'::uuid)
           AND NOT EXISTS (
             SELECT 1 FROM dispatch_assignments da
              WHERE da.vehicle_id = v.id AND da.status IN ('offered', 'accepted')
           )
         ORDER BY v.capacity_weight_kg ASC
         LIMIT 1
      ) free_fit ON TRUE
      WHERE d.tenant_id = $1
        AND d.status = 'active'
        AND d.availability = 'available'
        AND NOT EXISTS (
          SELECT 1 FROM dispatch_assignments da
           WHERE da.driver_id = d.id AND da.status IN ('offered', 'accepted')
        )
        AND (
          EXISTS (
            SELECT 1 FROM driver_shifts s
             WHERE s.driver_id = d.id
               AND s.starts_at <= now()
               AND s.ends_at >= now()
          )
          OR NOT EXISTS (
            SELECT 1 FROM driver_shifts s WHERE s.driver_id = d.id
          )
        )
        AND EXISTS (
          SELECT 1 FROM vehicles v
           WHERE v.status = 'active'
             AND v.capacity_weight_kg >= $3::double precision
             AND (
               v.capacity_volume_m3 IS NULL OR $4::double precision IS NULL
               OR v.capacity_volume_m3 >= $4::double precision
             )
             AND NOT EXISTS (
               SELECT 1 FROM dispatch_assignments da
                WHERE da.vehicle_id = v.id AND da.status IN ('offered', 'accepted')
             )
        )
      ORDER BY d.id
      `,
      [
        input.tenantId,
        input.pickupAddressId,
        input.weightKg,
        input.volumeM3,
      ],
    )) as Array<{
      driver_id: string;
      membership_id: string;
      distance_m: number | null;
      active_assignments: number;
      vehicle_id: string | null;
      capacity_slack: number | null;
    }>;
    return rows.map((row) => ({
      driverId: row.driver_id,
      membershipId: row.membership_id,
      distanceMeters: row.distance_m === null ? null : Number(row.distance_m),
      activeAssignments: Number(row.active_assignments),
      vehicleId: row.vehicle_id,
      capacitySlack: row.capacity_slack === null ? null : Number(row.capacity_slack),
    }));
  }

  private manager() {
    return this.txHost.tx;
  }
}

function toDomain(entity: AssignmentOrmEntity): Assignment {
  if (!isAssignmentStatus(entity.status)) {
    throw new Error(
      `Assignment ${entity.id} has unknown status "${entity.status}".`,
    );
  }
  return Assignment.rehydrate({
    id: entity.id,
    tenantId: entity.tenantId,
    shipmentId: entity.shipmentId,
    driverId: entity.driverId,
    vehicleId: entity.vehicleId,
    status: entity.status,
    offeredAt: entity.offeredAt,
    expiresAt: entity.expiresAt,
    respondedAt: entity.respondedAt,
    reason: entity.reason,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  });
}
