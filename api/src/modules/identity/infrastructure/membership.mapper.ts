import type {
  Membership,
  MembershipStatus,
  Role,
} from '../domain/membership.js';
import type { MembershipOrmEntity } from './membership.orm-entity.js';

/** Maps the persistence entity onto the domain model. */
export const MembershipMapper = {
  toDomain(entity: MembershipOrmEntity): Membership {
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      userId: entity.userId,
      role: entity.role as Role,
      status: entity.status as MembershipStatus,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  },
};
