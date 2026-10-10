import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { Repository } from 'typeorm';
import type { CreateUserInput, User } from '../domain/user.js';
import type {
  UserCredentials,
  UserRepository,
} from '../domain/user.repository.js';
import { UserMapper } from './user.mapper.js';
import { UserOrmEntity } from './user.orm-entity.js';

/** TypeORM implementation of the {@link UserRepository} port. */
@Injectable()
export class TypeOrmUserRepository implements UserRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async create(input: CreateUserInput): Promise<User> {
    const repository = this.repository();
    const entity = repository.create({
      email: input.email,
      name: input.name ?? null,
      passwordHash: input.passwordHash ?? null,
      isPlatformAdmin: input.isPlatformAdmin ?? false,
    });
    return UserMapper.toDomain(await repository.save(entity));
  }

  async findById(id: string): Promise<User | null> {
    const entity = await this.repository().findOne({ where: { id } });
    return entity ? UserMapper.toDomain(entity) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const entity = await this.repository().findOne({ where: { email } });
    return entity ? UserMapper.toDomain(entity) : null;
  }

  async findByEmailWithPassword(email: string): Promise<UserCredentials | null> {
    const entity = await this.repository().findOne({ where: { email } });
    if (!entity) {
      return null;
    }
    return { user: UserMapper.toDomain(entity), passwordHash: entity.passwordHash };
  }

  async setPassword(userId: string, passwordHash: string): Promise<User | null> {
    const repository = this.repository();
    const entity = await repository.findOne({ where: { id: userId } });
    if (!entity) {
      return null;
    }
    entity.passwordHash = passwordHash;
    return UserMapper.toDomain(await repository.save(entity));
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.repository().update(
      { id: userId },
      { emailVerifiedAt: new Date() },
    );
  }

  private repository(): Repository<UserOrmEntity> {
    return this.txHost.tx.getRepository(UserOrmEntity);
  }
}
