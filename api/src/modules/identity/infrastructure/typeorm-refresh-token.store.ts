import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { Repository } from 'typeorm';
import type {
  CreateRefreshTokenInput,
  RefreshToken,
  RefreshTokenStore,
} from '../domain/token.repository.js';
import { RefreshTokenOrmEntity } from './refresh-token.orm-entity.js';

/** TypeORM implementation of the {@link RefreshTokenStore} port. */
@Injectable()
export class TypeOrmRefreshTokenStore implements RefreshTokenStore {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async create(input: CreateRefreshTokenInput): Promise<RefreshToken> {
    const repository = this.repository();
    const entity = repository.create({
      userId: input.userId,
      tenantId: input.tenantId,
      familyId: input.familyId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    });
    return toDomain(await repository.save(entity));
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const entity = await this.repository().findOne({ where: { tokenHash } });
    return entity ? toDomain(entity) : null;
  }

  async revoke(id: string, replacedBy: string | null): Promise<void> {
    await this.repository().update(
      { id },
      { revokedAt: new Date(), replacedBy },
    );
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.repository()
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date() })
      .where('family_id = :familyId', { familyId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.repository()
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  private repository(): Repository<RefreshTokenOrmEntity> {
    return this.txHost.tx.getRepository(RefreshTokenOrmEntity);
  }
}

function toDomain(entity: RefreshTokenOrmEntity): RefreshToken {
  return {
    id: entity.id,
    userId: entity.userId,
    tenantId: entity.tenantId,
    familyId: entity.familyId,
    tokenHash: entity.tokenHash,
    expiresAt: entity.expiresAt,
    revokedAt: entity.revokedAt,
    replacedBy: entity.replacedBy,
    createdAt: entity.createdAt,
  };
}
