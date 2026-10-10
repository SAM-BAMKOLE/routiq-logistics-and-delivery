import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from './naming.strategy.js';

/**
 * Wires TypeORM into the Nest application as the restricted `ldms_app` role.
 *
 * The runtime connection is intentionally different from the migration CLI
 * (`data-source.ts`): it uses `DATABASE_URL`, is subject to Row Level Security
 * and may not run DDL. `synchronize` stays off forever — the schema is owned
 * by migrations.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        namingStrategy: new SnakeNamingStrategy(),
        // Feature modules register their entities with `forFeature`; this
        // collects them without a hand-maintained list.
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        logging: ['error', 'warn'],
      }),
    }),
  ],
})
export class DatabaseModule {}
