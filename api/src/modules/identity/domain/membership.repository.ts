import type {
  CreateMembershipInput,
  Membership,
  UpdateMembershipInput,
} from './membership.js';

/** DI token for the {@link MembershipRepository} port. */
export const MEMBERSHIP_REPOSITORY = Symbol('MEMBERSHIP_REPOSITORY');

/**
 * Outbound port for membership persistence.
 *
 * Reads and writes go through the transaction host, so inside a tenant
 * transaction RLS scopes them to the active tenant. The cross-tenant listing
 * used by login cannot use a tenant setting (there is none yet) and goes
 * through the `list_user_memberships` SECURITY DEFINER function instead.
 */
export interface MembershipRepository {
  create(input: CreateMembershipInput): Promise<Membership>;
  findById(id: string): Promise<Membership | null>;
  findByTenantAndUser(tenantId: string, userId: string): Promise<Membership | null>;
  /** Memberships of the active tenant (RLS-scoped), with their users. */
  listByTenant(tenantId: string): Promise<Membership[]>;
  update(id: string, changes: UpdateMembershipInput): Promise<Membership | null>;
  /** Cross-tenant listing for login: every membership of one user. */
  listForUserAcrossTenants(userId: string): Promise<MembershipWithTenant[]>;
  /** Active tenant-admin memberships in a tenant (last-admin protection). */
  countActiveAdmins(tenantId: string): Promise<number>;
}

/** One membership plus the tenant columns login needs to pick a default. */
export interface MembershipWithTenant {
  readonly membership: Membership;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly tenantStatus: string;
}
