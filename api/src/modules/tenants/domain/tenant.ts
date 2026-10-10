/**
 * The tenant aggregate, in domain terms: no TypeORM, no NestJS, just the shape
 * the application talks about. The persistence entity is mapped onto it in the
 * infrastructure layer.
 */
export const TENANT_STATUSES = ['active', 'suspended'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_PLANS = ['free', 'growth', 'enterprise'] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: TenantStatus;
  readonly plan: TenantPlan;
  readonly settings: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  plan?: TenantPlan;
  settings?: Record<string, unknown>;
}

export interface UpdateTenantInput {
  name?: string;
  status?: TenantStatus;
  plan?: TenantPlan;
  settings?: Record<string, unknown>;
}
