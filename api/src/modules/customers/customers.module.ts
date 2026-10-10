import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module.js';
import { CustomersService } from './application/customers.service.js';
import {
  ADDRESS_REPOSITORY,
  CUSTOMER_REPOSITORY,
} from './domain/customer.repository.js';
import { CustomerOrmEntity } from './infrastructure/customer.orm-entity.js';
import { SqlAddressRepository } from './infrastructure/sql-address.repository.js';
import { TypeOrmCustomerRepository } from './infrastructure/typeorm-customer.repository.js';
import { CustomersController } from './presentation/customers.controller.js';

/**
 * Customer profiles and saved addresses. Authorization comes from the
 * identity module's guards (imported, not re-provided); repository ports are
 * bound to their implementations here. Addresses use explicit parameterized
 * SQL behind the port because TypeORM cannot map `geography(Point)` values.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CustomerOrmEntity]), IdentityModule],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    TypeOrmCustomerRepository,
    SqlAddressRepository,
    { provide: CUSTOMER_REPOSITORY, useClass: TypeOrmCustomerRepository },
    { provide: ADDRESS_REPOSITORY, useClass: SqlAddressRepository },
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
