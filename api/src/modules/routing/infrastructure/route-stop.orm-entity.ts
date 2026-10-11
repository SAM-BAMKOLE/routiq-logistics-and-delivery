import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Persistence entity for the tenant-scoped `route_stops` table: one ordered
 * stop of a route, holding the shipment it serves. The unique index on
 * `shipment_id` enforces "a shipment is planned exactly once" at the schema
 * level; replanning deletes and reinserts a route's remaining stops inside
 * one transaction. See migration 1756000000014.
 */
@Entity('route_stops')
export class RouteStopOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Index('idx_route_stops_route_sequence')
  @Column({ type: 'uuid' })
  routeId: string;

  @Column({ type: 'uuid' })
  shipmentId: string;

  @Column({ type: 'integer' })
  sequence: number;

  /** v1 plans drop-off stops only; pickup stops arrive with PDPTW. */
  @Column({ type: 'text', default: 'dropoff' })
  kind: string;

  @Column({ type: 'timestamptz', nullable: true })
  plannedArrival: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  windowStart: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  windowEnd: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
