import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { Repository } from 'typeorm';
import type {
  CreateOneTimeTokenInput,
  OneTimeToken,
  OneTimeTokenStore,
  TokenPurpose,
} from '../domain/token.repository.js';
import { AuthTokenOrmEntity } from './auth-token.orm-entity.js';

/** TypeORM implementation of the {@link OneTimeTokenStore} port. */
@Injectable()
export class TypeOrmOneTimeTokenStore implements OneTimeTokenStore {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async create(input: CreateOneTimeTokenInput): Promise<OneTimeToken> {
    const repository = this.repository();
    const entity = repository.create({
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      metadata: input.metadata ?? {},
    });
    return toDomain(await repository.save(entity));
  }

  async findByHash(tokenHash: string): Promise<OneTimeToken | null> {
    const entity = await this.repository().findOne({ where: { tokenHash } });
    return entity ? toDomain(entity) : null;
  }

  async markUsed(id: string): Promise<void> {
    await this.repository().update({ id }, { usedAt: new Date() });
  }

  private repository(): Repository<AuthTokenOrmEntity> {
    return this.txHost.tx.getRepository(AuthTokenOrmEntity);
  }
}

function toDomain(entity: AuthTokenOrmEntity): OneTimeToken {
  return {
    id: entity.id,
    userId: entity.userId,
    purpose: entity.purpose as TokenPurpose,
    tokenHash: entity.tokenHash,
    expiresAt: entity.expiresAt,
    usedAt: entity.usedAt,
    metadata: entity.metadata,
  };
}
