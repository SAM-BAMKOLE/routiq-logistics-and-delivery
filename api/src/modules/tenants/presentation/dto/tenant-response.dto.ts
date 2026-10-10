import { ApiProperty } from '@nestjs/swagger';
import type { Tenant, TenantPlan, TenantStatus } from '../../domain/tenant.js';
import { TENANT_PLANS, TENANT_STATUSES } from '../../domain/tenant.js';

/** Wire representation of a tenant. Keeps dates in ISO-8601 UTC. */
export class TenantResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ enum: TENANT_STATUSES })
  status: TenantStatus;

  @ApiProperty({ enum: TENANT_PLANS })
  plan: TenantPlan;

  @ApiProperty({ type: Object })
  settings: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;

  static from(tenant: Tenant): TenantResponseDto {
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      plan: tenant.plan,
      settings: tenant.settings,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }
}
