import type { User, UserStatus } from '../domain/user.js';
import type { UserOrmEntity } from './user.orm-entity.js';

/** Maps the persistence entity onto the domain model. */
export const UserMapper = {
  toDomain(entity: UserOrmEntity): User {
    return {
      id: entity.id,
      email: entity.email,
      name: entity.name,
      isPlatformAdmin: entity.isPlatformAdmin,
      emailVerifiedAt: entity.emailVerifiedAt,
      status: entity.status as UserStatus,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      hasPassword: entity.passwordHash !== null,
    };
  },
};
