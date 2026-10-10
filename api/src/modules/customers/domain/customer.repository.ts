import type {
  Address,
  CreateAddressInput,
  CreateCustomerInput,
  Customer,
  UpdateAddressInput,
  UpdateCustomerInput,
} from './customer.js';

/** DI token for the {@link CustomerRepository} port. */
export const CUSTOMER_REPOSITORY = Symbol('CUSTOMER_REPOSITORY');

/** DI token for the {@link AddressRepository} port. */
export const ADDRESS_REPOSITORY = Symbol('ADDRESS_REPOSITORY');

/** Outbound port for customer persistence (tenant-scoped via RLS). */
export interface CustomerRepository {
  create(input: CreateCustomerInput & { tenantId: string }): Promise<Customer>;
  findById(id: string): Promise<Customer | null>;
  listByTenant(tenantId: string): Promise<Customer[]>;
  /** Customer profiles linked to a portal login (ownership policies). */
  listByUserId(tenantId: string, userId: string): Promise<Customer[]>;
  update(id: string, changes: UpdateCustomerInput): Promise<Customer | null>;
  remove(id: string): Promise<boolean>;
}

/** Outbound port for address persistence (tenant-scoped via RLS). */
export interface AddressRepository {
  create(
    input: CreateAddressInput & { tenantId: string; customerId: string },
  ): Promise<Address>;
  findById(id: string): Promise<Address | null>;
  listByCustomer(customerId: string): Promise<Address[]>;
  update(id: string, changes: UpdateAddressInput): Promise<Address | null>;
  remove(id: string): Promise<boolean>;
}
