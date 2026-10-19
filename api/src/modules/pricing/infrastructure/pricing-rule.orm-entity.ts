import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PricingSurcharge } from '../domain/pricing-rule.js';

/**
 * Persistence entity for the tenant-scoped `pricing_rules` table. Money is
 * `integer` (minor units); TypeORM maps it to a JS number, and the DTO layer
 * validates non-negative integers on the way in. `surcharges` is a jsonb
 * array - read and written whole, never queried by element.
 */
@Entity('pricing_rules')
export class PricingRuleOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'integer', default: 0 })
  baseFeeMinor: number;

  @Column({ type: 'integer', default: 0 })
  perKmMinor: number;

  @Column({ type: 'integer', default: 0 })
  perKgMinor: number;

  @Column({ type: 'integer', default: 0 })
  minFeeMinor: number;

  @Column({ type: 'integer', default: 0 })
  priority: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  activeFrom: Date;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  surcharges: PricingSurcharge[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
