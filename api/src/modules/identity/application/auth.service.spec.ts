import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AccessTokenIssuer } from './access-tokens.js';
import {
  AuthService,
  hashToken,
  type AuthResult,
} from './auth.service.js';
import type {
  Membership,
  MembershipStatus,
  Role,
} from '../domain/membership.js';
import type {
  MembershipRepository,
  MembershipWithTenant,
} from '../domain/membership.repository.js';
import type { PasswordHasher } from '../domain/password-hasher.js';
import type {
  CreateOneTimeTokenInput,
  CreateRefreshTokenInput,
  OneTimeToken,
  OneTimeTokenStore,
  RefreshToken,
  RefreshTokenStore,
} from '../domain/token.repository.js';
import type { User } from '../domain/user.js';
import type {
  UserCredentials,
  UserRepository,
} from '../domain/user.repository.js';
import type { TenantTransactionService } from '../../../shared/tenancy/tenant-transaction.service.js';
import { FakeEventBus } from '../../../shared/messaging/testing/fake-event-bus.js';

function userFixture(overrides: Partial<User & { password: string }> = {}): {
  user: User;
  passwordHash: string | null;
} {
  const password = overrides.password ?? 'password-123';
  const { password: _ignored, ...rest } = overrides;
  return {
    user: {
      id: 'u-1',
      email: 'a@example.com',
      name: null,
      isPlatformAdmin: false,
      emailVerifiedAt: null,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      hasPassword: true,
      ...rest,
    },
    passwordHash: `ph:${password}`,
  };
}

function membershipFixture(
  tenantId: string,
  userId: string,
  role: Role = 'dispatcher',
  status: MembershipStatus = 'active',
  tenantStatus = 'active',
): MembershipWithTenant {
  const membership: Membership = {
    id: `m-${tenantId}`,
    tenantId,
    userId,
    role,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    membership,
    tenantName: `Tenant ${tenantId}`,
    tenantSlug: `tenant-${tenantId}`,
    tenantStatus,
  };
}

interface Harness {
  service: AuthService;
  users: Map<string, { user: User; passwordHash: string | null }>;
  memberships: MembershipWithTenant[];
  refreshRows: RefreshToken[];
  oneTimeRows: OneTimeToken[];
  bus: FakeEventBus;
}

function makeHarness(): Harness {
  const users = new Map<string, { user: User; passwordHash: string | null }>();
  const memberships: MembershipWithTenant[] = [];
  const refreshRows: RefreshToken[] = [];
  const oneTimeRows: OneTimeToken[] = [];
  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}-${++seq}`;

  const userRepository: UserRepository = {
    create: async (input) => {
      const { user } = userFixture({
        id: nextId('u'),
        email: input.email,
        name: input.name ?? null,
        isPlatformAdmin: input.isPlatformAdmin ?? false,
      });
      const created = { ...user, hasPassword: input.passwordHash !== null };
      users.set(created.id, { user: created, passwordHash: input.passwordHash ?? null });
      return created;
    },
    findById: async (id) => users.get(id)?.user ?? null,
    findByEmail: async (email) =>
      [...users.values()].find((entry) => entry.user.email === email)?.user ?? null,
    findByEmailWithPassword: async (email): Promise<UserCredentials | null> => {
      const entry = [...users.values()].find((e) => e.user.email === email);
      return entry ? { user: entry.user, passwordHash: entry.passwordHash } : null;
    },
    setPassword: async (userId, passwordHash) => {
      const entry = users.get(userId);
      if (!entry) return null;
      entry.user = { ...entry.user, hasPassword: true };
      entry.passwordHash = passwordHash;
      return entry.user;
    },
    markEmailVerified: async (userId) => {
      const entry = users.get(userId);
      if (entry) entry.user = { ...entry.user, emailVerifiedAt: new Date() };
    },
  };

  const membershipRepository: MembershipRepository = {
    create: async (input) => {
      const created: Membership = {
        id: nextId('m'),
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role,
        status: input.status ?? 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memberships.push({
        membership: created,
        tenantName: created.tenantId,
        tenantSlug: created.tenantId,
        tenantStatus: 'active',
      });
      return created;
    },
    findById: async (id) =>
      memberships.find((e) => e.membership.id === id)?.membership ?? null,
    findByTenantAndUser: async (tenantId, userId) =>
      memberships.find(
        (e) => e.membership.tenantId === tenantId && e.membership.userId === userId,
      )?.membership ?? null,
    listByTenant: async (tenantId) =>
      memberships
        .filter((e) => e.membership.tenantId === tenantId)
        .map((e) => e.membership),
    update: async (id, changes) => {
      const index = memberships.findIndex((e) => e.membership.id === id);
      if (index < 0) return null;
      const current = memberships[index].membership;
      const updated: Membership = {
        ...current,
        role: changes.role ?? current.role,
        status: changes.status ?? current.status,
      };
      memberships[index] = { ...memberships[index], membership: updated };
      return updated;
    },
    listForUserAcrossTenants: async (userId) =>
      memberships.filter((e) => e.membership.userId === userId),
    countActiveAdmins: async (tenantId) =>
      memberships.filter(
        (e) =>
          e.membership.tenantId === tenantId &&
          e.membership.role === 'tenant_admin' &&
          e.membership.status === 'active',
      ).length,
  };

  const refreshStore: RefreshTokenStore = {
    create: async (input: CreateRefreshTokenInput) => {
      const row: RefreshToken = {
        id: nextId('r'),
        userId: input.userId,
        tenantId: input.tenantId,
        familyId: input.familyId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null,
        replacedBy: null,
        createdAt: new Date(),
      };
      refreshRows.push(row);
      return row;
    },
    findByHash: async (tokenHash) =>
      refreshRows.find((row) => row.tokenHash === tokenHash) ?? null,
    revoke: async (id, replacedBy) => {
      const row = refreshRows.find((r) => r.id === id);
      if (row) {
        refreshRows.splice(refreshRows.indexOf(row), 1, {
          ...row,
          revokedAt: new Date(),
          replacedBy,
        });
      }
    },
    revokeFamily: async (familyId) => {
      for (const row of refreshRows.filter((r) => r.familyId === familyId)) {
        refreshRows.splice(refreshRows.indexOf(row), 1, {
          ...row,
          revokedAt: new Date(),
        });
      }
    },
    revokeAllForUser: async (userId) => {
      for (const row of refreshRows.filter((r) => r.userId === userId)) {
        refreshRows.splice(refreshRows.indexOf(row), 1, {
          ...row,
          revokedAt: new Date(),
        });
      }
    },
  };

  const oneTimeStore: OneTimeTokenStore = {
    create: async (input: CreateOneTimeTokenInput) => {
      const row: OneTimeToken = {
        id: nextId('o'),
        userId: input.userId,
        purpose: input.purpose,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        metadata: input.metadata ?? {},
      };
      oneTimeRows.push(row);
      return row;
    },
    findByHash: async (tokenHash) =>
      oneTimeRows.find((row) => row.tokenHash === tokenHash) ?? null,
    markUsed: async (id) => {
      const row = oneTimeRows.find((r) => r.id === id);
      if (row) {
        oneTimeRows.splice(oneTimeRows.indexOf(row), 1, {
          ...row,
          usedAt: new Date(),
        });
      }
    },
  };

  const passwords: PasswordHasher = {
    hash: async (plain) => `ph:${plain}`,
    verify: async (hash, plain) => hash === `ph:${plain}`,
  };

  const issuer: AccessTokenIssuer = {
    sign: async (claims) =>
      `at.${claims.sub}.${claims.tid}.${claims.role}.${claims.adm}`,
    verify: async (token) => {
      const [, sub, tid, role, adm] = token.split('.');
      return {
        sub,
        tid: tid === 'null' ? null : tid,
        role: role === 'null' ? null : role,
        adm: adm === 'true',
        type: 'access' as const,
      };
    },
  };

  const transactions = {
    runWithTenant: async <T>(
      _tenantId: string,
      fn: (manager: never) => Promise<T>,
    ): Promise<T> => fn(undefined as never),
  } as unknown as TenantTransactionService;

  const config = {
    get: (key: string): unknown =>
      key === 'JWT_REFRESH_TTL_DAYS' ? 30 : key === 'JWT_ACCESS_TTL' ? '15m' : undefined,
  } as ConfigService;

  const bus = new FakeEventBus();

  const service = new AuthService(
    userRepository,
    membershipRepository,
    refreshStore,
    oneTimeStore,
    passwords,
    issuer,
    bus,
    transactions,
    config,
  );

  return { service, users, memberships, refreshRows, oneTimeRows, bus };
}

function seedUser(
  harness: Harness,
  overrides: Parameters<typeof userFixture>[0] = {},
): { user: User; password: string } {
  const password = overrides.password ?? 'password-123';
  const { user, passwordHash } = userFixture({ ...overrides, password });
  harness.users.set(user.id, { user, passwordHash });
  return { user, password };
}

describe('AuthService', () => {
  describe('login', () => {
    it('issues a session scoped to the first active membership', async () => {
      const h = makeHarness();
      const { user, password } = seedUser(h);
      h.memberships.push(membershipFixture('t-1', user.id));
      h.memberships.push(membershipFixture('t-2', user.id, 'driver'));

      const result: AuthResult = await h.service.login({
        email: user.email,
        password,
      });

      expect(result.tenant?.id).toBe('t-1');
      expect(result.tenant?.role).toBe('dispatcher');
      expect(result.accessToken).toContain(user.id);
      expect(h.refreshRows).toHaveLength(1);
    });

    it('honours an explicit tenantId', async () => {
      const h = makeHarness();
      const { user, password } = seedUser(h);
      h.memberships.push(membershipFixture('t-1', user.id));
      h.memberships.push(membershipFixture('t-2', user.id, 'driver'));

      const result = await h.service.login({
        email: user.email,
        password,
        tenantId: 't-2',
      });

      expect(result.tenant?.id).toBe('t-2');
      expect(result.tenant?.role).toBe('driver');
    });

    it('rejects unknown users and wrong passwords identically', async () => {
      const h = makeHarness();
      const { user, password } = seedUser(h);
      h.memberships.push(membershipFixture('t-1', user.id));

      const wrongPassword = h.service
        .login({ email: user.email, password: 'nope' })
        .catch((error) => error);
      const unknownUser = h.service
        .login({ email: 'ghost@example.com', password })
        .catch((error) => error);

      for (const error of [await wrongPassword, await unknownUser]) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.getResponse()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      }
    });

    it('rejects suspended users, unknown tenants, and suspended tenants', async () => {
      const h = makeHarness();
      const { user, password } = seedUser(h, { status: 'suspended' });
      h.memberships.push(membershipFixture('t-1', user.id));

      await expect(
        h.service.login({ email: user.email, password }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });

      const active = seedUser(h, { id: 'u-2', email: 'b@example.com' });
      h.memberships.push(membershipFixture('t-1', 'u-2', 'dispatcher', 'active', 'suspended'));

      await expect(
        h.service.login({ email: active.user.email, password: active.password }),
      ).rejects.toMatchObject({ response: { code: 'NO_ACTIVE_MEMBERSHIP' } });

      await expect(
        h.service.login({
          email: active.user.email,
          password: active.password,
          tenantId: 't-9',
        }),
      ).rejects.toMatchObject({ response: { code: 'NO_ACTIVE_MEMBERSHIP' } });
    });

    it('issues a platform session for an admin with no memberships', async () => {
      const h = makeHarness();
      const { user, password } = seedUser(h, { isPlatformAdmin: true });

      const result = await h.service.login({ email: user.email, password });

      expect(result.tenant).toBeNull();
      expect(result.user.isPlatformAdmin).toBe(true);
    });

    it('requires a membership for non-admins', async () => {
      const h = makeHarness();
      const { user, password } = seedUser(h);

      await expect(
        h.service.login({ email: user.email, password }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('refresh rotation', () => {
    it('rotates on every use and rejects the predecessor afterwards', async () => {
      const h = makeHarness();
      const { user, password } = seedUser(h);
      h.memberships.push(membershipFixture('t-1', user.id));

      const first = await h.service.login({ email: user.email, password });
      const second = await h.service.refresh(first.refreshToken);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(h.refreshRows).toHaveLength(2);

      await expect(h.service.refresh(first.refreshToken)).rejects.toMatchObject({
        response: { code: 'REFRESH_TOKEN_REUSED' },
      });
      // Reuse poisons the family: even the newest token is dead (any revoked
      // presentation is treated as replay).
      await expect(h.service.refresh(second.refreshToken)).rejects.toMatchObject({
        response: { code: 'REFRESH_TOKEN_REUSED' },
      });
    });

    it('rejects unknown refresh tokens', async () => {
      const h = makeHarness();
      await expect(h.service.refresh('bogus')).rejects.toMatchObject({
        response: { code: 'INVALID_REFRESH_TOKEN' },
      });
    });
  });

  describe('switch-tenant', () => {
    it('scopes the session to another membership of the same user', async () => {
      const h = makeHarness();
      const { user, password } = seedUser(h);
      h.memberships.push(membershipFixture('t-1', user.id));
      h.memberships.push(membershipFixture('t-2', user.id, 'driver'));

      const first = await h.service.login({ email: user.email, password });
      const switched = await h.service.switchTenant(first.refreshToken, 't-2');

      expect(switched.tenant?.id).toBe('t-2');
      expect(switched.tenant?.role).toBe('driver');
    });

    it('rejects tenants the user does not belong to', async () => {
      const h = makeHarness();
      const { user, password } = seedUser(h);
      h.memberships.push(membershipFixture('t-1', user.id));

      const first = await h.service.login({ email: user.email, password });
      await expect(h.service.switchTenant(first.refreshToken, 't-9')).rejects.toMatchObject(
        {
          response: { code: 'NO_ACTIVE_MEMBERSHIP' },
        },
      );
    });
  });

  describe('logout', () => {
    it('revokes the token and stays silent for unknown tokens', async () => {
      const h = makeHarness();
      const { user, password } = seedUser(h);
      h.memberships.push(membershipFixture('t-1', user.id));

      const first = await h.service.login({ email: user.email, password });
      await h.service.logout(first.refreshToken);

      await expect(h.service.refresh(first.refreshToken)).rejects.toMatchObject({
        response: { code: 'REFRESH_TOKEN_REUSED' },
      });
      await expect(h.service.logout('bogus')).resolves.toBeUndefined();
    });
  });

  describe('forgot/reset password', () => {
    it('stores a hashed reset token and publishes the raw one', async () => {
      const h = makeHarness();
      const { user } = seedUser(h);

      await h.service.forgotPassword(user.email);

      expect(h.oneTimeRows).toHaveLength(1);
      expect(h.oneTimeRows[0].purpose).toBe('reset');
      // Only the hash is stored: the raw token exists solely in the event.
      expect(h.oneTimeRows[0].tokenHash).not.toContain('raw');
      const event = h.bus.lastOfType('PasswordResetRequested');
      expect(event).toBeDefined();
      expect(event?.tenantId).toBeNull();
      expect(event?.payload['email']).toBe(user.email);
      expect(event?.payload['resetToken']).toEqual(
        expect.any(String),
      );
      expect(h.oneTimeRows[0].tokenHash).toBe(
        hashToken(event?.payload['resetToken'] as string),
      );
    });

    it('answers the same for unknown addresses: event with no token', async () => {
      const h = makeHarness();

      await h.service.forgotPassword('ghost@example.com');

      expect(h.oneTimeRows).toHaveLength(0);
      const event = h.bus.lastOfType('PasswordResetRequested');
      expect(event).toBeDefined();
      expect(event?.payload['resetToken']).toBeNull();
    });

    it('applies the new password, consumes the token, revokes sessions', async () => {
      const h = makeHarness();
      const { user, password } = seedUser(h);
      h.memberships.push(membershipFixture('t-1', user.id));
      const session = await h.service.login({ email: user.email, password });

      await h.service.forgotPassword(user.email);
      const raw = h.bus.lastOfType('PasswordResetRequested')?.payload[
        'resetToken'
      ] as string;

      await h.service.resetPassword(raw, 'brand-new-password-123');

      expect(h.oneTimeRows[0].usedAt).not.toBeNull();
      expect(h.users.get(user.id)?.passwordHash).toBe(
        'ph:brand-new-password-123',
      );
      // The old session was revoked by the password change: presenting it
      // counts as reuse and is rejected loudly.
      await expect(h.service.refresh(session.refreshToken)).rejects.toMatchObject(
        { response: { code: 'REFRESH_TOKEN_REUSED' } },
      );
      // And the new password works.
      await expect(
        h.service.login({ email: user.email, password: 'brand-new-password-123' }),
      ).resolves.toMatchObject({ user: { id: user.id } });
    });

    it('rejects unknown, reused, and expired reset tokens distinctly', async () => {
      const h = makeHarness();
      const { user } = seedUser(h);

      await expect(
        h.service.resetPassword('bogus', 'whatever-123'),
      ).rejects.toMatchObject({ response: { code: 'RESET_TOKEN_INVALID' } });

      await h.service.forgotPassword(user.email);
      const raw = h.bus.lastOfType('PasswordResetRequested')?.payload[
        'resetToken'
      ] as string;
      await h.service.resetPassword(raw, 'first-password-123');

      await expect(
        h.service.resetPassword(raw, 'second-password-123'),
      ).rejects.toMatchObject({ response: { code: 'RESET_TOKEN_EXPIRED' } });

      // Expired-by-clock path.
      h.oneTimeRows.push({
        id: 'o-expired',
        userId: user.id,
        purpose: 'reset',
        tokenHash: hashToken('late-token'),
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
        metadata: {},
      });
      await expect(
        h.service.resetPassword('late-token', 'late-password-123'),
      ).rejects.toMatchObject({ response: { code: 'RESET_TOKEN_EXPIRED' } });
    });
  });

  describe('accept-invite', () => {
    function issueInvite(h: Harness, userId: string): string {
      const raw = 'invite-raw-token';
      h.oneTimeRows.push({
        id: 'o-1',
        userId,
        purpose: 'invite',
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 3600_000),
        usedAt: null,
        metadata: { tenantId: 't-1', role: 'dispatcher' },
      });
      h.memberships.push({
        membership: {
          id: 'm-1',
          tenantId: 't-1',
          userId,
          role: 'dispatcher',
          status: 'invited',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        tenantName: 'T1',
        tenantSlug: 't1',
        tenantStatus: 'active',
      });
      return raw;
    }

    it('sets the password, activates, consumes the token, and logs in', async () => {
      const h = makeHarness();
      const stored = userFixture({ id: 'u-9', email: 'new@example.com' });
      h.users.set('u-9', {
        user: { ...stored.user, hasPassword: false },
        passwordHash: null,
      });

      const result = await h.service.acceptInvite(issueInvite(h, 'u-9'), 'new-password-123');

      expect(result.tenant?.id).toBe('t-1');
      expect(h.oneTimeRows[0].usedAt).not.toBeNull();
      const credentials = h.users.get('u-9');
      expect(credentials?.passwordHash).toBe('ph:new-password-123');
      expect(credentials?.user.emailVerifiedAt).not.toBeNull();
    });

    it('rejects reused and unknown tokens', async () => {
      const h = makeHarness();
      const stored = userFixture({ id: 'u-9', email: 'new@example.com' });
      h.users.set('u-9', {
        user: { ...stored.user, hasPassword: false },
        passwordHash: null,
      });
      const raw = issueInvite(h, 'u-9');

      await h.service.acceptInvite(raw, 'new-password-123');
      await expect(h.service.acceptInvite(raw, 'another-password')).rejects.toMatchObject(
        {
          response: { code: 'INVITATION_EXPIRED' },
        },
      );
      await expect(h.service.acceptInvite('bogus', 'x'.repeat(12))).rejects.toMatchObject(
        {
          response: { code: 'INVALID_INVITATION' },
        },
      );
    });
  });
});
