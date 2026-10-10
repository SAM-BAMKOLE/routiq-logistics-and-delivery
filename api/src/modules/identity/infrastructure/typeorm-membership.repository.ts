import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { Repository } from 'typeorm';
import type {
  CreateMembershipInput,
  Membership,
  UpdateMembershipInput,
} from '../domain/membership.js';
import type {
  MembershipRepository,
  MembershipWithTenant,
} from '../domain/membership.repository.js';
import { MembershipMapper } from './membership.mapper.js';
import { MembershipOrmEntity } from './membership.orm-entity.js';

/** Row shape returned by the `list_user_memberships` function. */
interface MembershipLookupRow {
  membership_id: string;
  tenant_id: string;
  role: string;
  status: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: string;
}

/** TypeORM implementation of the {@link MembershipRepository} port. */
@Injectable()
export class TypeOrmMembershipRepository implements MembershipRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async create(input: CreateMembershipInput): Promise<Membership> {
    const repository = this.repository();
    const entity = repository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      status: input.status ?? 'active',
    });
    return MembershipMapper.toDomain(await repository.save(entity));
  }

  async findById(id: string): Promise<Membership | null> {
    const entity = await this.repository().findOne({ where: { id } });
    return entity ? MembershipMapper.toDomain(entity) : null;
  }

  async findByTenantAndUser(
    tenantId: string,
    userId: string,
  ): Promise<Membership | null> {
    const entity = await this.repository().findOne({
      where: { tenantId, userId },
    });
    return entity ? MembershipMapper.toDomain(entity) : null;
  }

  async listByTenant(tenantId: string): Promise<Membership[]> {
    const entities = await this.repository().find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => MembershipMapper.toDomain(entity));
  }

  async update(
    id: string,
    changes: UpdateMembershipInput,
  ): Promise<Membership | null> {
    const repository = this.repository();
    const entity = await repository.findOne({ where: { id } });
    if (!entity) {
      return null;
    }
    repository.merge(entity, changes);
    return MembershipMapper.toDomain(await repository.save(entity));
  }

  /**
   * Cross-tenant listing through the `list_user_memberships` SECURITY DEFINER
   * function. Used by login, which has no tenant setting yet: plain queries
   * would see nothing under RLS. Runs on the ambient manager (the transaction
   * host's fallback outside a transaction).
   */
  async listForUserAcrossTenants(userId: string): Promise<MembershipWithTenant[]> {
    const rows = (await this.txHost.tx.query(
      `SELECT * FROM list_user_memberships($1)`,
      [userId],
    )) as MembershipLookupRow[];

    return rows.map((row) => ({
      membership: {
        id: row.membership_id,
        tenantId: row.tenant_id,
        userId,
        role: row.role as Membership['role'],
        status: row.status as Membership['status'],
        // The function returns no timestamps; they are irrelevant for login.
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      tenantName: row.tenant_name,
      tenantSlug: row.tenant_slug,
      tenantStatus: row.tenant_status,
    }));
  }

  async countActiveAdmins(tenantId: string): Promise<number> {
    return this.repository().count({
      where: { tenantId, role: 'tenant_admin', status: 'active' },
    });
  }

  private repository(): Repository<MembershipOrmEntity> {
    return this.txHost.tx.getRepository(MembershipOrmEntity);
  }
}
