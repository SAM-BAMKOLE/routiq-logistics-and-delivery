import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';
import { validate } from '../../src/config/env.validation.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { AuthService } from '../../src/modules/identity/application/auth.service.js';
import { UsersService } from '../../src/modules/identity/application/users.service.js';
import { IdentityModule } from '../../src/modules/identity/identity.module.js';
import { JwtAuthGuard } from '../../src/modules/identity/presentation/guards/jwt-auth.guard.js';
import { Argon2PasswordHasher } from '../../src/modules/identity/infrastructure/argon2-password-hasher.js';
import { TenantContextService } from '../../src/shared/tenancy/tenant-context.service.js';
import { TenantTransactionService } from '../../src/shared/tenancy/tenant-transaction.service.js';
import { TenancyModule } from '../../src/shared/tenancy/tenancy.module.js';
import { MessagingModule } from '../../src/shared/messaging/messaging.module.js';
import {
  createOwnerDataSource,
  ensureSchema,
} from './helpers/database.js';
import { readDatabaseState } from './helpers/state.js';

const PASSWORD = 'correct-horse-123';

/**
 * Authentication against a real PostGIS database: the login membership lookup
 * goes through the `list_user_memberships` SECURITY DEFINER function as the
 * restricted `ldms_app` role, refresh rotation persists across calls, reuse
 * revokes the family, and the guard revalidates membership and tenant status
 * on every request.
 */
describe('Identity authentication (integration)', () => {
  let app: INestApplication;
  let auth: AuthService;
  let users: UsersService;
  let guard: JwtAuthGuard;
  let context: TenantContextService;
  let transactions: TenantTransactionService;
  let cls: ClsService;
  let owner: DataSource;

  let tenantA: string;
  let tenantB: string;
  let emailA: string;

  beforeAll(async () => {
    await ensureSchema();
    owner = await createOwnerDataSource();

    const hasher = new Argon2PasswordHasher();
    const passwordHash = await hasher.hash(PASSWORD);
    emailA = `auth-a-${randomUUID()}@example.com`;
    const emailB = `auth-b-${randomUUID()}@example.com`;

    const tenants = (await owner.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`,
      ['Auth Tenant A', `auth-a-${randomUUID()}`, 'Auth Tenant B', `auth-b-${randomUUID()}`],
    )) as Array<{ id: string }>;
    [tenantA, tenantB] = tenants.map((row) => row.id);

    const userRows = (await owner.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2), ($3, $2) RETURNING id`,
      [emailA, passwordHash, emailB],
    )) as Array<{ id: string }>;

    await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'tenant_admin'), ($3, $2, 'driver'), ($3, $4, 'dispatcher')`,
      [tenantA, userRows[0].id, tenantB, userRows[1].id],
    );

    process.env.DATABASE_URL = readDatabaseState().appUrl;
    process.env.JWT_ACCESS_SECRET = 'integration-test-access-secret-min-32-chars';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
        DatabaseModule,
        TenancyModule,
        MessagingModule,
        IdentityModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    auth = app.get(AuthService);
    users = app.get(UsersService);
    guard = app.get(JwtAuthGuard);
    context = app.get(TenantContextService);
    transactions = app.get(TenantTransactionService);
    cls = app.get(ClsService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (owner?.isInitialized) {
      await owner.destroy();
    }
  });

  function guardContext(token?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: token ? { authorization: `Bearer ${token}` } : {},
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('logs in across tenants through the lookup function', async () => {
    const result = await auth.login({ email: emailA, password: PASSWORD });

    expect(result.tenant?.id).toBe(tenantA);
    expect(result.tenant?.role).toBe('tenant_admin');
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);

    const explicit = await auth.login({
      email: emailA,
      password: PASSWORD,
      tenantId: tenantB,
    });
    expect(explicit.tenant?.id).toBe(tenantB);
    expect(explicit.tenant?.role).toBe('driver');
  });

  it('rejects wrong passwords without revealing user existence', async () => {
    await expect(
      auth.login({ email: emailA, password: 'wrong-password' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });
    await expect(
      auth.login({ email: `ghost-${randomUUID()}@example.com`, password: PASSWORD }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const first = await auth.login({ email: emailA, password: PASSWORD });
    const second = await auth.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);

    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({
      response: { code: 'REFRESH_TOKEN_REUSED' },
    });
    await expect(auth.refresh(second.refreshToken)).rejects.toMatchObject({
      response: { code: 'REFRESH_TOKEN_REUSED' },
    });
  });

  it('switches tenants within one session family', async () => {
    const first = await auth.login({ email: emailA, password: PASSWORD });
    const switched = await auth.switchTenant(first.refreshToken, tenantB);

    expect(switched.tenant?.id).toBe(tenantB);
    // The predecessor rotated: the original refresh token is spent.
    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({
      response: { code: 'REFRESH_TOKEN_REUSED' },
    });
  });

  it('logs out by revoking the presented token', async () => {
    const first = await auth.login({ email: emailA, password: PASSWORD });
    await auth.logout(first.refreshToken);

    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({
      response: { code: 'REFRESH_TOKEN_REUSED' },
    });
  });

  it('validates membership and tenant on every guarded request', async () => {
    const session = await auth.login({ email: emailA, password: PASSWORD });

    await cls.run(async () => {
      await expect(guard.canActivate(guardContext(session.accessToken))).resolves.toBe(
        true,
      );
      expect(context.get()).toMatchObject({
        tenantId: tenantA,
        role: 'tenant_admin',
        isPlatformAdmin: false,
      });
    });

    await expect(guard.canActivate(guardContext())).rejects.toMatchObject({
      response: { code: 'ACCESS_TOKEN_MISSING' },
    });
    await expect(guard.canActivate(guardContext('bogus'))).rejects.toMatchObject({
      response: { code: 'ACCESS_TOKEN_INVALID' },
    });
  });

  it('blocks logins into suspended tenants', async () => {
    await owner.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [
      tenantB,
    ]);

    await expect(
      auth.login({ email: emailA, password: PASSWORD, tenantId: tenantB }),
    ).rejects.toMatchObject({ response: { code: 'NO_ACTIVE_MEMBERSHIP' } });

    await owner.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [
      tenantB,
    ]);
  });

  it('invites, accepts, and lists members with last-admin protection', async () => {
    const inviteEmail = `invited-${randomUUID()}@example.com`;
    const { membership, inviteToken } = await transactions.runWithTenant(
      tenantA,
      () =>
        users.invite(tenantA, {
          email: inviteEmail,
          role: 'dispatcher',
        }),
    );
    expect(membership.status).toBe('invited');

    const accepted = await auth.acceptInvite(inviteToken, 'new-member-pass-123');
    expect(accepted.tenant?.id).toBe(tenantA);

    const members = await transactions.runWithTenant(tenantA, () =>
      users.listMembers(tenantA),
    );
    expect(members.map((member) => member.email)).toContain(inviteEmail);

    // Tenant A has exactly one active admin, so demoting them fails.
    const adminMembership = members.find((member) => member.role === 'tenant_admin');
    expect(adminMembership).toBeDefined();
    await expect(
      transactions.runWithTenant(tenantA, () =>
        users.updateMembership(tenantA, adminMembership?.membershipId ?? '', {
          role: 'driver',
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'LAST_TENANT_ADMIN' } });
  });
});
