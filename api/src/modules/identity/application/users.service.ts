import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Membership,
  Role,
  UpdateMembershipInput,
} from '../domain/membership.js';
import type { MembershipRepository } from '../domain/membership.repository.js';
import { MEMBERSHIP_REPOSITORY } from '../domain/membership.repository.js';
import type {
  OneTimeTokenStore,
} from '../domain/token.repository.js';
import { ONE_TIME_TOKEN_STORE } from '../domain/token.repository.js';
import type { UserRepository } from '../domain/user.repository.js';
import { USER_REPOSITORY } from '../domain/user.repository.js';
import { hashToken, normalizeEmail } from './auth.service.js';
import { INVITE_TTL } from './auth.service.js';
import { randomBytes } from 'node:crypto';
import { EVENT_BUS, type EventBus } from '../../../shared/messaging/event-bus.js';
import { createEnvelope } from '../../../shared/messaging/event-envelope.js';

export interface InviteInput {
  email: string;
  role: Role;
  name?: string;
}

export interface TenantMember {
  userId: string;
  email: string;
  name: string | null;
  membershipId: string;
  role: Role;
  membershipStatus: Membership['status'];
}

/**
 * Application service for tenant user management. Every method takes the
 * tenant explicitly and runs inside the request's tenant transaction, so RLS
 * scopes all membership access — the explicit `tenantId` comparisons below
 * are defense in depth that also produce correct 404s across tenants.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly memberships: MembershipRepository,
    @Inject(ONE_TIME_TOKEN_STORE)
    private readonly oneTimeTokens: OneTimeTokenStore,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  async listMembers(tenantId: string): Promise<TenantMember[]> {
    const memberships = await this.memberships.listByTenant(tenantId);
    const members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await this.users.findById(membership.userId);
        // Memberships cascade-delete with their user, so this is unreachable
        // in practice; skipping keeps the list total instead of failing it.
        if (!user) {
          return null;
        }
        return {
          userId: user.id,
          email: user.email,
          name: user.name,
          membershipId: membership.id,
          role: membership.role,
          membershipStatus: membership.status,
        } satisfies TenantMember;
      }),
    );
    return members.filter((member) => member !== null);
  }

  /**
   * Invites an email address into the tenant. New addresses get a user row
   * without a password; everyone gets an `invited` membership plus a
   * single-use token.
   *
   * The `UserInvited` event is what delivers the token: the Notifications
   * module mails it (invite-user template). The raw token is still
   * returned to programmatic callers (integration tests), but the HTTP API
   * no longer puts it in a response body.
   */
  async invite(
    tenantId: string,
    input: InviteInput,
  ): Promise<{ membership: Membership; inviteToken: string }> {
    const email = normalizeEmail(input.email);

    let user = await this.users.findByEmail(email);
    if (!user) {
      user = await this.users.create({ email, name: input.name ?? null });
    }

    const existing = await this.memberships.findByTenantAndUser(
      tenantId,
      user.id,
    );
    if (existing?.status === 'active') {
      throw membershipExists(email);
    }
    if (existing?.status === 'suspended') {
      throw membershipExists(email);
    }

    const membership =
      existing ??
      (await this.memberships.create({
        tenantId,
        userId: user.id,
        role: input.role,
        status: 'invited',
      }));

    const rawToken = randomBytes(32).toString('hex');
    await this.oneTimeTokens.create({
      userId: user.id,
      purpose: 'invite',
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + INVITE_TTL),
      metadata: { tenantId, role: membership.role },
    });

    await this.events.publish(
      createEnvelope({
        type: 'UserInvited',
        tenantId,
        aggregateType: 'membership',
        aggregateId: membership.id,
        payload: {
          email,
          role: membership.role,
          // Phase-1 in-process delivery; see the listener's note on why a
          // reference replaces this once events flow through the outbox.
          inviteToken: rawToken,
        },
      }),
    );

    return { membership, inviteToken: rawToken };
  }

  async updateMembership(
    tenantId: string,
    membershipId: string,
    changes: UpdateMembershipInput,
  ): Promise<Membership> {
    const membership = await this.memberships.findById(membershipId);
    if (!membership || membership.tenantId !== tenantId) {
      throw membershipNotFound(membershipId);
    }

    if (await this.wouldRemoveLastAdmin(membership, changes)) {
      throw lastAdmin();
    }

    const updated = await this.memberships.update(membershipId, changes);
    if (!updated) {
      throw membershipNotFound(membershipId);
    }
    return updated;
  }

  /**
   * A tenant must always keep one active admin: demoting or suspending the
   * last one would lock everyone out of administration.
   */
  private async wouldRemoveLastAdmin(
    membership: Membership,
    changes: UpdateMembershipInput,
  ): Promise<boolean> {
    if (membership.role !== 'tenant_admin' || membership.status !== 'active') {
      return false;
    }
    const demotes = changes.role !== undefined && changes.role !== 'tenant_admin';
    const suspends = changes.status !== undefined && changes.status !== 'active';
    if (!demotes && !suspends) {
      return false;
    }
    const admins = await this.memberships.countActiveAdmins(membership.tenantId);
    return admins <= 1;
  }
}

function membershipExists(email: string): ConflictException {
  return new ConflictException({
    message: `A membership already exists for ${email} in this tenant.`,
    code: 'MEMBERSHIP_EXISTS',
  });
}

function membershipNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Membership ${id} was not found in this tenant.`,
    code: 'MEMBERSHIP_NOT_FOUND',
  });
}

function lastAdmin(): ConflictException {
  return new ConflictException({
    message:
      'This tenant must keep at least one active tenant admin.',
    code: 'LAST_TENANT_ADMIN',
  });
}
