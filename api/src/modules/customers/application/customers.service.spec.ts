import { NotFoundException } from '@nestjs/common';
import type {
  Address,
  CreateAddressInput,
  CreateCustomerInput,
  Customer,
  UpdateAddressInput,
  UpdateCustomerInput,
} from '../domain/customer.js';
import type {
  AddressRepository,
  CustomerRepository,
} from '../domain/customer.repository.js';
import { CustomersService } from './customers.service.js';

function customerFixture(id: string, tenantId: string): Customer {
  return {
    id,
    tenantId,
    name: `Customer ${id}`,
    email: null,
    phone: null,
    userId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function addressFixture(id: string, tenantId: string, customerId: string): Address {
  return {
    id,
    tenantId,
    customerId,
    line1: '14 Warehouse Road',
    line2: null,
    city: 'Lagos',
    region: null,
    country: 'NG',
    postalCode: null,
    latitude: 6.5244,
    longitude: 3.3792,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface Harness {
  service: CustomersService;
  customers: Map<string, Customer>;
  addresses: Map<string, Address>;
}

function makeHarness(): Harness {
  const customers = new Map<string, Customer>();
  const addresses = new Map<string, Address>();
  let seq = 0;

  const customerRepository: CustomerRepository = {
    create: async (input: CreateCustomerInput & { tenantId: string }) => {
      const customer = {
        ...customerFixture(`c-${++seq}`, input.tenantId),
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        userId: input.userId ?? null,
      };
      customers.set(customer.id, customer);
      return customer;
    },
    findById: async (id) => customers.get(id) ?? null,
    listByTenant: async (tenantId) =>
      [...customers.values()].filter((c) => c.tenantId === tenantId),
    listByUserId: async (tenantId, userId) =>
      [...customers.values()].filter(
        (c) => c.tenantId === tenantId && c.userId === userId,
      ),
    update: async (id, changes: UpdateCustomerInput) => {
      const current = customers.get(id);
      if (!current) return null;
      const updated: Customer = {
        ...current,
        name: changes.name ?? current.name,
        email: changes.email !== undefined ? changes.email : current.email,
        phone: changes.phone !== undefined ? changes.phone : current.phone,
        userId: changes.userId !== undefined ? changes.userId : current.userId,
      };
      customers.set(id, updated);
      return updated;
    },
    remove: async (id) => customers.delete(id),
  };

  const addressRepository: AddressRepository = {
    create: async (input) => {
      const address: Address = {
        ...addressFixture(`a-${++seq}`, input.tenantId, input.customerId),
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        region: input.region ?? null,
        country: input.country,
        postalCode: input.postalCode ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
      };
      addresses.set(address.id, address);
      return address;
    },
    findById: async (id) => addresses.get(id) ?? null,
    listByCustomer: async (customerId) =>
      [...addresses.values()].filter((a) => a.customerId === customerId),
    update: async (id, changes: UpdateAddressInput) => {
      const current = addresses.get(id);
      if (!current) return null;
      const updated: Address = { ...current, ...changes };
      addresses.set(id, updated);
      return updated;
    },
    remove: async (id) => addresses.delete(id),
  };

  return {
    service: new CustomersService(customerRepository, addressRepository),
    customers,
    addresses,
  };
}

describe('CustomersService', () => {
  it('creates and reads customers inside the tenant', async () => {
    const h = makeHarness();
    const created = await h.service.createCustomer('t-1', { name: 'Acme' });

    expect(created.tenantId).toBe('t-1');
    expect(await h.service.getCustomer('t-1', created.id)).toEqual(created);
    expect(await h.service.listCustomers('t-1')).toHaveLength(1);
  });

  it('returns 404 for unknown customers and other tenants', async () => {
    const h = makeHarness();
    const created = await h.service.createCustomer('t-1', { name: 'Acme' });

    await expect(h.service.getCustomer('t-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(h.service.getCustomer('t-2', created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates and removes customers', async () => {
    const h = makeHarness();
    const created = await h.service.createCustomer('t-1', { name: 'Acme' });

    const updated = await h.service.updateCustomer('t-1', created.id, {
      phone: '+100',
    });
    expect(updated.phone).toBe('+100');

    await h.service.removeCustomer('t-1', created.id);
    await expect(h.service.getCustomer('t-1', created.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('scopes addresses to their customer and tenant', async () => {
    const h = makeHarness();
    const customer = await h.service.createCustomer('t-1', { name: 'Acme' });
    const other = await h.service.createCustomer('t-1', { name: 'Other' });

    const address = await h.service.createAddress('t-1', customer.id, {
      line1: '14 Warehouse Road',
      city: 'Lagos',
      country: 'NG',
    } as CreateAddressInput);
    expect(address.customerId).toBe(customer.id);

    // Same address id under another customer reads as 404, not a leak.
    await expect(
      h.service.getAddress('t-1', other.id, address.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      h.service.getAddress('t-2', customer.id, address.id),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(await h.service.listAddresses('t-1', customer.id)).toHaveLength(1);

    const updated = await h.service.updateAddress('t-1', customer.id, address.id, {
      city: 'Abuja',
    });
    expect(updated.city).toBe('Abuja');

    await h.service.removeAddress('t-1', customer.id, address.id);
    expect(await h.service.listAddresses('t-1', customer.id)).toHaveLength(0);
  });

  it('rejects addresses for unknown customers', async () => {
    const h = makeHarness();
    await expect(
      h.service.createAddress('t-1', 'missing', {
        line1: 'x',
        city: 'y',
        country: 'z',
      } as CreateAddressInput),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
