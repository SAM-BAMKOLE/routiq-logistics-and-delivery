import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ACCESS_TOKEN_ISSUER,
  parseTtlToSeconds,
} from './application/access-tokens.js';
import { AuthService } from './application/auth.service.js';
import { SessionValidator } from './application/session-validator.js';
import { UsersService } from './application/users.service.js';
import {
  MEMBERSHIP_REPOSITORY,
} from './domain/membership.repository.js';
import {
  ONE_TIME_TOKEN_STORE,
  REFRESH_TOKEN_STORE,
} from './domain/token.repository.js';
import { PASSWORD_HASHER } from './domain/password-hasher.js';
import { USER_REPOSITORY } from './domain/user.repository.js';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher.js';
import { AuthTokenOrmEntity } from './infrastructure/auth-token.orm-entity.js';
import { JwtAccessIssuer } from './infrastructure/jwt-access-issuer.js';
import { MembershipOrmEntity } from './infrastructure/membership.orm-entity.js';
import { RefreshTokenOrmEntity } from './infrastructure/refresh-token.orm-entity.js';
import { TypeOrmMembershipRepository } from './infrastructure/typeorm-membership.repository.js';
import { TypeOrmOneTimeTokenStore } from './infrastructure/typeorm-one-time-token.store.js';
import { TypeOrmRefreshTokenStore } from './infrastructure/typeorm-refresh-token.store.js';
import { TypeOrmUserRepository } from './infrastructure/typeorm-user.repository.js';
import { UserOrmEntity } from './infrastructure/user.orm-entity.js';
import { AuthController } from './presentation/auth.controller.js';
import { JwtAuthGuard } from './presentation/guards/jwt-auth.guard.js';
import { PermissionsGuard } from './presentation/guards/permissions.guard.js';
import { PlatformAdminGuard } from './presentation/guards/platform-admin.guard.js';
import { MembershipsController } from './presentation/memberships.controller.js';
import { UsersController } from './presentation/users.controller.js';

/**
 * Identity module: users, memberships, credentials, tokens, and the guards
 * that authenticate and authorize every request. Repository ports are bound
 * to their TypeORM implementations here; the guards are exported so feature
 * modules (tenants, and later shipments) can protect their routes.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserOrmEntity,
      MembershipOrmEntity,
      RefreshTokenOrmEntity,
      AuthTokenOrmEntity,
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      // Seconds (a number) rather than the raw string: the JWT library types
      // expiries narrowly, and seconds are unambiguous.
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: parseTtlToSeconds(
            config.get<string>('JWT_ACCESS_TTL') ?? '15m',
            900,
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController, UsersController, MembershipsController],
  providers: [
    AuthService,
    UsersService,
    SessionValidator,
    JwtAuthGuard,
    PermissionsGuard,
    PlatformAdminGuard,
    JwtAccessIssuer,
    Argon2PasswordHasher,
    TypeOrmUserRepository,
    TypeOrmMembershipRepository,
    TypeOrmRefreshTokenStore,
    TypeOrmOneTimeTokenStore,
    { provide: USER_REPOSITORY, useClass: TypeOrmUserRepository },
    { provide: MEMBERSHIP_REPOSITORY, useClass: TypeOrmMembershipRepository },
    { provide: REFRESH_TOKEN_STORE, useClass: TypeOrmRefreshTokenStore },
    { provide: ONE_TIME_TOKEN_STORE, useClass: TypeOrmOneTimeTokenStore },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: ACCESS_TOKEN_ISSUER, useClass: JwtAccessIssuer },
  ],
  exports: [
    AuthService,
    UsersService,
    SessionValidator,
    JwtAuthGuard,
    PermissionsGuard,
    PlatformAdminGuard,
    // Port tokens used by the exported guards: `@UseGuards` instantiates a
    // guard in the importing module's injector, so its dependencies must be
    // resolvable there. The remaining stores stay module-private.
    USER_REPOSITORY,
    MEMBERSHIP_REPOSITORY,
    ACCESS_TOKEN_ISSUER,
  ],
})
export class IdentityModule {}
