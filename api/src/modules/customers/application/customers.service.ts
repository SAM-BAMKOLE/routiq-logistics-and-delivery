import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Address,
  CreateAddressInput,
  CreateCustomerInput,
  Customer,
  UpdateAddressInput,
  UpdateCustomerInput,
} from '../domain/customer.js';
import {
  ADDRESS_REPOSITORY,
  CUSTOMER_REPOSITORY,
  type AddressRepository,
  type CustomerRepository,
} from '../domain/customer.repository.js';

/**
 * Application service for customers and their addresses. Every method takes
 * the tenant explicitly and runs inside the request's tenant transaction, so
 * RLS scopes all access — the explicit `tenantId` comparisons are defense in
 * depth that also produce correct 404s across tenants.
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
    @Inject(ADDRESS_REPOSITORY) private readonly addresses: AddressRepository,
  ) {}

  createCustomer(tenantId: string, input: CreateCustomerInput): Promise<Customer> {
    return this.customers.create({ ...input, tenantId });
  }

  listCustomers(tenantId: string): Promise<Customer[]> {
    return this.customers.listByTenant(tenantId);
  }

  async getCustomer(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.customers.findById(id);
    if (!customer || customer.tenantId !== tenantId) {
      throw customerNotFound(id);
    }
    return customer;
  }

  async updateCustomer(
    tenantId: string,
    id: string,
    changes: UpdateCustomerInput,
  ): Promise<Customer> {
    const customer = await this.customers.findById(id);
    if (!customer || customer.tenantId !== tenantId) {
      throw customerNotFound(id);
    }
    const updated = await this.customers.update(id, changes);
    if (!updated) {
      throw customerNotFound(id);
    }
    return updated;
  }

  async removeCustomer(tenantId: string, id: string): Promise<void> {
    const customer = await this.customers.findById(id);
    if (!customer || customer.tenantId !== tenantId) {
      throw customerNotFound(id);
    }
    await this.customers.remove(id);
  }

  async createAddress(
    tenantId: string,
    customerId: string,
    input: CreateAddressInput,
  ): Promise<Address> {
    await this.getCustomer(tenantId, customerId);
    try {
      return await this.addresses.create({ ...input, tenantId, customerId });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        // The customer passed the check above but vanished in a race.
        throw customerNotFound(customerId);
      }
      throw error;
    }
  }

  async listAddresses(tenantId: string, customerId: string): Promise<Address[]> {
    await this.getCustomer(tenantId, customerId);
    const addresses = await this.addresses.listByCustomer(customerId);
    return addresses.filter((address) => address.tenantId === tenantId);
  }

  async getAddress(
    tenantId: string,
    customerId: string,
    id: string,
  ): Promise<Address> {
    const address = await this.addresses.findById(id);
    if (
      !address ||
      address.tenantId !== tenantId ||
      address.customerId !== customerId
    ) {
      throw addressNotFound(id);
    }
    return address;
  }

  async updateAddress(
    tenantId: string,
    customerId: string,
    id: string,
    changes: UpdateAddressInput,
  ): Promise<Address> {
    await this.getAddress(tenantId, customerId, id);
    const updated = await this.addresses.update(id, changes);
    if (!updated) {
      throw addressNotFound(id);
    }
    return updated;
  }

  async removeAddress(
    tenantId: string,
    customerId: string,
    id: string,
  ): Promise<void> {
    await this.getAddress(tenantId, customerId, id);
    await this.addresses.remove(id);
  }
}

function customerNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Customer ${id} was not found in this tenant.`,
    code: 'CUSTOMER_NOT_FOUND',
  });
}

function addressNotFound(id: string): NotFoundException {
  return new NotFoundException({
    message: `Address ${id} was not found for this customer.`,
    code: 'ADDRESS_NOT_FOUND',
  });
}

/** Postgres foreign-key violation, surfaced on `driverError`. */
function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const driverError = (error as { driverError?: { code?: string } }).driverError;
  return driverError?.code === '23503';
}
