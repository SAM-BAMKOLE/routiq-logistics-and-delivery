import { ConflictException, NotFoundException } from '@nestjs/common';
import type {
  Membership,
  Role,
} from '../domain/membership.js';
import type { MembershipRepository } from '../domain/membership.repository.js';
import type { OneTimeTokenStore } from '../domain/token.repository.js';
import type { User } from '../domain/user.js';
import type { UserRepository } from '../domain/user.repository.js';
import { UsersService } from './users.service.js';

function makeUser(id: string, email: string): User {
  return {
    id,
    email,
    name: null,
    isPlatformAdmin: false,
    emailVerifiedAt: null,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    hasPassword: true,
  };
}

function makeMembership(
  id: string,
  tenantId: string,
  userId: string,
  role: Role,
  status: Membership['status'] = 'active',
): Membership {
  return {
    id,
    tenantId,
    userId,
    role,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface Harness {
  service: UsersService;
  users: Map<string, User>;
  memberships: Membership[];
  issuedTokens: number;
}

function makeHarness(): Harness {
  const users = new Map<string, User>();
  const memberships: Membership[] = [];
  let issuedTokens = 0;

  const userRepository: UserRepository = {
    create: async (input) => {
      const user = makeUser(`u-${users.size + 1}`, input.email);
      users.set(user.id, user);
      return user;
    },
    findById: async (id) => users.get(id) ?? null,
    findByEmail: async (email) =>
      [...users.values()].find((user) => user.email === email) ?? null,
    findByEmailWithPassword: async () => null,
    setPassword: async () => null,
    markEmailVerified: async () => undefined,
  };

  const membershipRepository: MembershipRepository = {
    create: async (input) => {
      const created = makeMembership(
        `m-${memberships.length + 1}`,
        input.tenantId,
        input.userId,
        input.role,
        input.status ?? 'active',
      );
      memberships.push(created);
      return created;
    },
    findById: async (id) => memberships.find((m) => m.id === id) ?? null,
    findByTenantAndUser: async (tenantId, userId) =>
      memberships.find((m) => m.tenantId === tenantId && m.userId === userId) ?? null,
    listByTenant: async (tenantId) => memberships.filter((m) => m.tenantId === tenantId),
    update: async (id, changes) => {
      const index = memberships.findIndex((m) => m.id === id);
      if (index < 0) return null;
      memberships[index] = { ...memberships[index], ...changes };
      return memberships[index];
    },
    listForUserAcrossTenants: async () => [],
    countActiveAdmins: async (tenantId) =>
      memberships.filter(
        (m) => m.tenantId === tenantId && m.role === 'tenant_admin' && m.status === 'active',
      ).length,
  };

  const oneTimeTokens: OneTimeTokenStore = {
    create: async (input) => {
      issuedTokens += 1;
      return {
        id: `o-${issuedTokens}`,
        userId: input.userId,
        purpose: input.purpose,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        metadata: input.metadata ?? {},
      };
    },
    findByHash: async () => null,
    markUsed: async () => undefined,
  };

  return {
    service: new UsersService(userRepository, membershipRepository, oneTimeTokens),
    users,
    memberships,
    get issuedTokens() {
      return issuedTokens;
    },
  };
}

describe('UsersService', () => {
  describe('listMembers', () => {
    it('returns tenant members enriched with their users', async () => {
      const h = makeHarness();
      h.users.set('u-1', makeUser('u-1', 'a@example.com'));
      h.users.set('u-2', makeUser('u-2', 'b@example.com'));
      h.memberships.push(makeMembership('m-1', 't-1', 'u-1', 'tenant_admin'));
      h.memberships.push(makeMembership('m-2', 't-1', 'u-2', 'driver'));
      h.memberships.push(makeMembership('m-3', 't-2', 'u-2', 'driver'));

      const members = await h.service.listMembers('t-1');

      expect(members).toEqual([
        {
          userId: 'u-1',
          email: 'a@example.com',
          name: null,
          membershipId: 'm-1',
          role: 'tenant_admin',
          membershipStatus: 'active',
        },
        {
          userId: 'u-2',
          email: 'b@example.com',
          name: null,
          membershipId: 'm-2',
          role: 'driver',
          membershipStatus: 'active',
        },
      ]);
    });
  });

  describe('invite', () => {
    it('creates a user, an invited membership, and a token for new emails', async () => {
      const h = makeHarness();

      const { membership, inviteToken } = await h.service.invite('t-1', {
        email: 'New@Example.com',
        role: 'dispatcher',
      });

      expect(membership).toMatchObject({
        tenantId: 't-1',
        role: 'dispatcher',
        status: 'invited',
      });
      expect(inviteToken).toMatch(/^[0-9a-f]{64}$/);
      // Email is normalized at the boundary.
      expect([...h.users.values()].map((u) => u.email)).toEqual(['new@example.com']);
    });

    it('rejects inviting an already-active member', async () => {
      const h = makeHarness();
      h.users.set('u-1', makeUser('u-1', 'a@example.com'));
      h.memberships.push(makeMembership('m-1', 't-1', 'u-1', 'driver'));

      await expect(
        h.service.invite('t-1', { email: 'a@example.com', role: 'driver' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reissues a token for a pending invitation instead of duplicating', async () => {
      const h = makeHarness();
      h.users.set('u-1', makeUser('u-1', 'a@example.com'));
      h.memberships.push(makeMembership('m-1', 't-1', 'u-1', 'driver', 'invited'));

      const first = await h.service.invite('t-1', {
        email: 'a@example.com',
        role: 'driver',
      });
      const second = await h.service.invite('t-1', {
        email: 'a@example.com',
        role: 'driver',
      });

      expect(first.membership.id).toBe('m-1');
      expect(second.membership.id).toBe('m-1');
      expect(second.inviteToken).not.toBe(first.inviteToken);
      expect(h.memberships).toHaveLength(1);
    });
  });

  describe('updateMembership', () => {
    it('updates role and status inside the tenant', async () => {
      const h = makeHarness();
      h.memberships.push(makeMembership('m-1', 't-1', 'u-1', 'tenant_admin'));
      h.memberships.push(makeMembership('m-2', 't-1', 'u-2', 'driver'));

      const updated = await h.service.updateMembership('t-1', 'm-2', {
        role: 'dispatcher',
      });

      expect(updated).toMatchObject({ role: 'dispatcher', status: 'active' });
    });

    it('returns 404 for unknown memberships and other tenants', async () => {
      const h = makeHarness();
      h.memberships.push(makeMembership('m-1', 't-1', 'u-1', 'driver'));

      await expect(
        h.service.updateMembership('t-1', 'm-9', { role: 'dispatcher' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        h.service.updateMembership('t-2', 'm-1', { role: 'dispatcher' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to demote or suspend the last active admin', async () => {
      const h = makeHarness();
      h.memberships.push(makeMembership('m-1', 't-1', 'u-1', 'tenant_admin'));

      await expect(
        h.service.updateMembership('t-1', 'm-1', { role: 'driver' }),
      ).rejects.toMatchObject({ response: { code: 'LAST_TENANT_ADMIN' } });
      await expect(
        h.service.updateMembership('t-1', 'm-1', { status: 'suspended' }),
      ).rejects.toMatchObject({ response: { code: 'LAST_TENANT_ADMIN' } });
    });

    it('allows demotion while another active admin remains', async () => {
      const h = makeHarness();
      h.memberships.push(makeMembership('m-1', 't-1', 'u-1', 'tenant_admin'));
      h.memberships.push(makeMembership('m-2', 't-1', 'u-2', 'tenant_admin'));

      const updated = await h.service.updateMembership('t-1', 'm-1', {
        role: 'driver',
      });

      expect(updated.role).toBe('driver');
    });
  });
});
