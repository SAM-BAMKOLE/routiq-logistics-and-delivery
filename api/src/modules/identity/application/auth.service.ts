import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { AccessTokenIssuer } from './access-tokens.js';
import { ACCESS_TOKEN_ISSUER, parseTtlToSeconds } from './access-tokens.js';
import type {
  MembershipRepository,
  MembershipWithTenant,
} from '../domain/membership.repository.js';
import { MEMBERSHIP_REPOSITORY } from '../domain/membership.repository.js';
import type { PasswordHasher } from '../domain/password-hasher.js';
import { PASSWORD_HASHER } from '../domain/password-hasher.js';
import type {
  OneTimeTokenStore,
  RefreshToken,
  RefreshTokenStore,
} from '../domain/token.repository.js';
import {
  ONE_TIME_TOKEN_STORE,
  REFRESH_TOKEN_STORE,
} from '../domain/token.repository.js';
import type { Role } from '../domain/membership.js';
import { isRole } from '../domain/membership.js';
import type { User } from '../domain/user.js';
import type { UserRepository } from '../domain/user.repository.js';
import { USER_REPOSITORY } from '../domain/user.repository.js';
import { TenantTransactionService } from '../../../shared/tenancy/tenant-transaction.service.js';
import { EVENT_BUS, type EventBus } from '../../../shared/messaging/event-bus.js';
import { createEnvelope } from '../../../shared/messaging/event-envelope.js';

export interface LoginInput {
  email: string;
  password: string;
  tenantId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds, so clients can schedule renewal. */
  expiresIn: number;
}

export interface AuthResult extends TokenPair {
  user: PublicUser;
  tenant: ActiveTenant | null;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  isPlatformAdmin: boolean;
}

export interface ActiveTenant {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

/**
 * Input for self-service company sign-up: the freshly created tenant plus the
 * credentials of the person who will administer it.
 */
export interface RegisterTenantAdminInput {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  email: string;
  password: string;
  name?: string | null;
}

/** Invitation lifetime: 7 days. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Password-reset token lifetime: 1 hour — long enough to read the mail, short enough to stay useful. */
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Application service for authentication: login, refresh rotation, logout,
 * tenant switching, and invitation acceptance. It owns the credential and
 * token rules and knows nothing about HTTP.
 *
 * Security notes:
 * - Unknown users and wrong passwords produce the identical 401, so the two
 *   cases are indistinguishable over the wire.
 * - Refresh tokens are opaque; only their SHA-256 hash is stored. Every use
 *   rotates (a successor is created, then the predecessor is revoked).
 *   Presenting an already-revoked token signals theft, so the whole family
 *   is revoked.
 * - Membership listing for login goes through the `list_user_memberships`
 *   SECURITY DEFINER function: login has no tenant setting yet, so plain
 *   queries would see nothing under RLS.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly memberships: MembershipRepository,
    @Inject(REFRESH_TOKEN_STORE)
    private readonly refreshTokens: RefreshTokenStore,
    @Inject(ONE_TIME_TOKEN_STORE)
    private readonly oneTimeTokens: OneTimeTokenStore,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(ACCESS_TOKEN_ISSUER)
    private readonly accessTokens: AccessTokenIssuer,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly transactions: TenantTransactionService,
    private readonly config: ConfigService,
  ) {}

  async login(input: LoginInput): Promise<AuthResult> {
    const credentials = await this.users.findByEmailWithPassword(
      normalizeEmail(input.email),
    );
    if (
      !credentials ||
      credentials.user.status !== 'active' ||
      !credentials.passwordHash ||
      !(await this.passwords.verify(credentials.passwordHash, input.password))
    ) {
      throw invalidCredentials();
    }

    const user = credentials.user;
    const usable = await this.usableMemberships(user.id);

    let active: MembershipWithTenant | null = null;
    if (input.tenantId) {
      active =
        usable.find((entry) => entry.membership.tenantId === input.tenantId) ??
        null;
      if (!active) {
        // Deliberately the same shape whether the tenant exists or the
        // membership is inactive: no tenant oracle.
        throw noActiveMembership();
      }
    } else {
      active = usable[0] ?? null;
    }

    if (!active && !user.isPlatformAdmin) {
      throw noActiveMembership();
    }

    return this.issueSession(user, active, randomUUID(), null);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const session = await this.consumeRefreshToken(refreshToken);
    return this.issueSession(
      session.user,
      session.active,
      session.row.familyId,
      session.row.id,
    );
  }

  async switchTenant(refreshToken: string, tenantId: string): Promise<AuthResult> {
    const session = await this.consumeRefreshToken(refreshToken);
    const target =
      session.memberships.find(
        (entry) =>
          entry.membership.tenantId === tenantId &&
          entry.membership.status === 'active' &&
          entry.tenantStatus === 'active',
      ) ?? null;
    if (!target) {
      throw noActiveMembership();
    }
    return this.issueSession(
      session.user,
      target,
      session.row.familyId,
      session.row.id,
    );
  }

  /** Revokes one refresh token. Always succeeds silently: no token oracle. */
  async logout(refreshToken: string): Promise<void> {
    const row = await this.refreshTokens.findByHash(hashToken(refreshToken));
    if (row && !row.revokedAt) {
      await this.refreshTokens.revoke(row.id, null);
    }
  }

  /**
   * Starts a password reset. The response and the published event are
   * identical for known and unknown addresses — the listener stops when
   * the event carries no token — so this endpoint cannot be used to
   * enumerate accounts, and the reset mail is the only signal that the
   * address exists.
   */
  async forgotPassword(emailInput: string): Promise<void> {
    const email = normalizeEmail(emailInput);
    const user = await this.users.findByEmail(email);

    let rawToken: string | null = null;
    if (user && user.status === 'active') {
      rawToken = randomBytes(32).toString('hex');
      await this.oneTimeTokens.create({
        userId: user.id,
        purpose: 'reset',
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
        metadata: {},
      });
    }

    await this.events.publish(
      createEnvelope({
        type: 'PasswordResetRequested',
        tenantId: null,
        aggregateType: 'user',
        // No row for an unknown address; the event still fires so the
        // caller sees the same behavior either way.
        aggregateId: user?.id ?? email,
        payload: { email, resetToken: rawToken },
      }),
    );
  }

  /**
   * Consumes a reset link: single-use token in, new password stored,
   * every existing session revoked. The password change signs out any
   * session the requester was not already holding.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const row = await this.oneTimeTokens.findByHash(hashToken(token));
    if (!row || row.purpose !== 'reset') {
      throw invalidResetToken();
    }
    if (row.usedAt || row.expiresAt.getTime() <= Date.now()) {
      throw expiredResetToken();
    }

    const user = await this.users.findById(row.userId);
    if (!user || user.status !== 'active') {
      throw invalidResetToken();
    }

    await this.users.setPassword(user.id, await this.passwords.hash(password));
    await this.oneTimeTokens.markUsed(row.id);
    await this.refreshTokens.revokeAllForUser(user.id);
  }

  async acceptInvite(token: string, password: string): Promise<AuthResult> {
    const row = await this.oneTimeTokens.findByHash(hashToken(token));
    if (!row || row.purpose !== 'invite') {
      throw invalidInvitation();
    }
    if (row.usedAt || row.expiresAt.getTime() <= Date.now()) {
      throw expiredInvitation();
    }

    const tenantId = row.metadata['tenantId'];
    const role = row.metadata['role'];
    if (typeof tenantId !== 'string' || !isRole(role)) {
      throw invalidInvitation();
    }

    const user = await this.users.findById(row.userId);
    if (!user || user.status !== 'active') {
      throw invalidInvitation();
    }

    await this.users.setPassword(user.id, await this.passwords.hash(password));
    await this.users.markEmailVerified(user.id);

    // The invite token is the credential here, so this runs outside any user
    // transaction — like a background job — scoped to the invited tenant.
    const membership = await this.transactions.runWithTenant(
      tenantId,
      async () => {
        const existing = await this.memberships.findByTenantAndUser(
          tenantId,
          user.id,
        );
        if (!existing) {
          throw invalidInvitation();
        }
        if (existing.status !== 'active') {
          return this.memberships.update(existing.id, { status: 'active' });
        }
        return existing;
      },
    );
    if (!membership) {
      throw invalidInvitation();
    }

    await this.oneTimeTokens.markUsed(row.id);

    // The membership alone carries no tenant identity, so look the tenant up
    // to return a complete session (otherwise the client would show a blank
    // company name until its next refresh).
    const withTenants = await this.memberships.listForUserAcrossTenants(
      user.id,
    );
    const info = withTenants.find(
      (entry) => entry.membership.tenantId === tenantId,
    );

    return this.issueSession(
      user,
      {
        membership,
        tenantName: info?.tenantName ?? '',
        tenantSlug: info?.tenantSlug ?? '',
        tenantStatus: info?.tenantStatus ?? 'active',
      },
      randomUUID(),
      null,
    );
  }

  /**
   * Provisions the first administrator of a new tenant and returns a ready
   * session. This is the self-service counterpart to the platform-admin +
   * invitation flow: it backs public company sign-up, where the founder both
   * creates the company and becomes its `tenant_admin` in one step.
   */
  async registerTenantAdmin(
    input: RegisterTenantAdminInput,
  ): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    if (await this.users.findByEmail(email)) {
      throw emailTaken();
    }

    const user = await this.users.create({
      email,
      name: input.name ?? null,
      passwordHash: await this.passwords.hash(input.password),
    });
    await this.users.markEmailVerified(user.id);

    // Scope the membership write to its tenant, so it behaves exactly like
    // every other membership created inside a tenant.
    const membership = await this.transactions.runWithTenant(
      input.tenantId,
      async () =>
        this.memberships.create({
          tenantId: input.tenantId,
          userId: user.id,
          role: 'tenant_admin',
          status: 'active',
        }),
    );

    return this.issueSession(
      user,
      {
        membership,
        tenantName: input.tenantName,
        tenantSlug: input.tenantSlug,
        tenantStatus: 'active',
      },
      randomUUID(),
      null,
    );
  }

  /** Active memberships in non-suspended tenants, for one user. */
  private async usableMemberships(userId: string): Promise<MembershipWithTenant[]> {
    const all = await this.memberships.listForUserAcrossTenants(userId);
    return all.filter(
      (entry) =>
        entry.membership.status === 'active' && entry.tenantStatus === 'active',
    );
  }

  /**
   * Validates a refresh token: known, unrevoked, unexpired, and still backed
   * by an active user and membership. A revoked token presented again means
   * replay, so the whole family dies.
   */
  private async consumeRefreshToken(refreshToken: string): Promise<{
    row: RefreshToken;
    user: User;
    memberships: MembershipWithTenant[];
    active: MembershipWithTenant | null;
  }> {
    const row = await this.refreshTokens.findByHash(hashToken(refreshToken));
    if (!row) {
      throw invalidRefreshToken();
    }
    if (row.revokedAt) {
      await this.refreshTokens.revokeFamily(row.familyId);
      throw refreshTokenReused();
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw invalidRefreshToken();
    }

    const user = await this.users.findById(row.userId);
    if (!user || user.status !== 'active') {
      throw invalidRefreshToken();
    }

    let active: MembershipWithTenant | null = null;
    let memberships: MembershipWithTenant[] = [];
    if (row.tenantId) {
      memberships = await this.memberships.listForUserAcrossTenants(user.id);
      active =
        memberships.find(
          (entry) =>
            entry.membership.tenantId === row.tenantId &&
            entry.membership.status === 'active' &&
            entry.tenantStatus === 'active',
        ) ?? null;
      if (!active) {
        throw noActiveMembership();
      }
    } else if (!user.isPlatformAdmin) {
      throw invalidRefreshToken();
    }

    return { row, user, memberships, active };
  }

  /**
   * Issues an access token plus a fresh refresh token in the given family.
   * The successor is created before the predecessor is revoked, so a crash
   * between the two leaves a usable session rather than a dead one.
   */
  private async issueSession(
    user: User,
    active: MembershipWithTenant | null,
    familyId: string,
    predecessorId: string | null,
  ): Promise<AuthResult> {
    const tenantId = active?.membership.tenantId ?? null;
    const role = active?.membership.role ?? null;

    const accessToken = await this.accessTokens.sign({
      sub: user.id,
      tid: tenantId,
      role,
      adm: user.isPlatformAdmin,
    });

    const rawRefresh = randomBytes(32).toString('hex');
    const successor = await this.refreshTokens.create({
      userId: user.id,
      tenantId,
      familyId,
      tokenHash: hashToken(rawRefresh),
      expiresAt: refreshExpiry(this.config),
    });
    if (predecessorId) {
      await this.refreshTokens.revoke(predecessorId, successor.id);
    }

    return {
      accessToken,
      refreshToken: rawRefresh,
      expiresIn: accessTtlSeconds(this.config),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      tenant: active
        ? {
            id: active.membership.tenantId,
            name: active.tenantName,
            slug: active.tenantSlug,
            role: active.membership.role,
          }
        : null,
    };
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** SHA-256 hex of an opaque token. Fast hash, not password hashing: the token itself has 256 bits of entropy. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function refreshExpiry(config: ConfigService): Date {
  const days = config.get<number>('JWT_REFRESH_TTL_DAYS') ?? 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function accessTtlSeconds(config: ConfigService): number {
  return parseTtlToSeconds(config.get<string>('JWT_ACCESS_TTL') ?? '15m', 900);
}

function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'The email or password is incorrect.',
    code: 'INVALID_CREDENTIALS',
  });
}

function emailTaken(): ConflictException {
  return new ConflictException({
    message: 'An account already exists for this email address.',
    code: 'EMAIL_TAKEN',
  });
}

function invalidRefreshToken(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'The refresh token is invalid or expired.',
    code: 'INVALID_REFRESH_TOKEN',
  });
}

function refreshTokenReused(): UnauthorizedException {
  return new UnauthorizedException({
    message:
      'This refresh token was already used. The session family was revoked; please log in again.',
    code: 'REFRESH_TOKEN_REUSED',
  });
}

function noActiveMembership(): ForbiddenException {
  return new ForbiddenException({
    message: 'There is no active membership for this tenant.',
    code: 'NO_ACTIVE_MEMBERSHIP',
  });
}

function invalidInvitation(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'The invitation is invalid.',
    code: 'INVALID_INVITATION',
  });
}

function expiredInvitation(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'The invitation has expired or was already used.',
    code: 'INVITATION_EXPIRED',
  });
}

function invalidResetToken(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'The password reset link is invalid.',
    code: 'RESET_TOKEN_INVALID',
  });
}

function expiredResetToken(): UnauthorizedException {
  return new UnauthorizedException({
    message: 'The password reset link has expired or was already used.',
    code: 'RESET_TOKEN_EXPIRED',
  });
}

/** Re-exported for the invitation flow, which shares the invite lifetime. */
export const INVITE_TTL = INVITE_TTL_MS;
