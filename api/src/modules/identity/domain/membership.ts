/**
 * Membership: a user's role inside one tenant, in domain terms.
 *
 * Roles belong to memberships, never to users: the same person can be a tenant
 * admin in one tenant and a driver in another. The platform admin is a flag on
 * the user, not a role, and carries no tenant context by design.
 */
export const ROLES = ['tenant_admin', 'dispatcher', 'driver', 'customer'] as const;
export type Role = (typeof ROLES)[number];

export const MEMBERSHIP_STATUSES = ['active', 'invited', 'suspended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export interface Membership {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly role: Role;
  readonly status: MembershipStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateMembershipInput {
  tenantId: string;
  userId: string;
  role: Role;
  status?: MembershipStatus;
}

export interface UpdateMembershipInput {
  role?: Role;
  status?: MembershipStatus;
}

/**
 * Permissions are named on routes (`@RequirePermissions('users:invite')`) and
 * roles map to permissions here, in code. `tenant_admin` holds `'*'`.
 * Ownership checks (a driver reading only assigned shipments, …) are
 * application policies in the owning modules; RLS backstops both.
 */
export type Permission =
  | 'users:read'
  | 'users:invite'
  | 'memberships:update'
  | 'tenants:manage'
  | 'shipments:create'
  | 'shipments:read'
  | 'shipments:read-own'
  | 'shipments:read-assigned'
  | 'shipments:update'
  | 'shipments:update-status'
  | 'dispatch:manage'
  | 'routes:manage'
  | 'routes:read-own'
  | 'fleet:read'
  | 'fleet:manage'
  | 'reports:read'
  | 'quotes:create'
  | 'profile:read-own';

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[] | ['*']> = {
  tenant_admin: ['*'],
  dispatcher: [
    'shipments:create',
    'shipments:read',
    'shipments:update',
    'dispatch:manage',
    'routes:manage',
    'fleet:read',
    'reports:read',
  ],
  driver: [
    'shipments:read-assigned',
    'shipments:update-status',
    'routes:read-own',
    'profile:read-own',
  ],
  customer: ['shipments:create', 'shipments:read-own', 'quotes:create', 'profile:read-own'],
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  const permissions: readonly string[] = ROLE_PERMISSIONS[role];
  return permissions.includes('*') || permissions.includes(permission);
}

/** Runtime check that a string is a known role (roles arrive as text from tokens and the database). */
export function isRole(value: unknown): value is Role {
  return (
    value === 'tenant_admin' ||
    value === 'dispatcher' ||
    value === 'driver' ||
    value === 'customer'
  );
}
