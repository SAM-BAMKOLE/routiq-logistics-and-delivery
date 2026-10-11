import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { validate } from '../../src/config/env.validation.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { CustomersService } from '../../src/modules/customers/application/customers.service.js';
import { CustomersModule } from '../../src/modules/customers/customers.module.js';
import { DriversService } from '../../src/modules/drivers/application/drivers.service.js';
import { DriversModule } from '../../src/modules/drivers/drivers.module.js';
import { FleetModule } from '../../src/modules/fleet/fleet.module.js';
import { IdentityModule } from '../../src/modules/identity/identity.module.js';
import { PricingModule } from '../../src/modules/pricing/pricing.module.js';
import { PricingRulesService } from '../../src/modules/pricing/application/pricing-rules.service.js';
import { QuotesService } from '../../src/modules/pricing/application/quotes.service.js';
import { ShipmentsModule } from '../../src/modules/shipments/shipments.module.js';
import { ShipmentsService } from '../../src/modules/shipments/application/shipments.service.js';
import { TenantsModule } from '../../src/modules/tenants/tenants.module.js';
import { TenantTransactionService } from '../../src/shared/tenancy/tenant-transaction.service.js';
import { TenancyModule } from '../../src/shared/tenancy/tenancy.module.js';
import { MessagingModule } from '../../src/shared/messaging/messaging.module.js';
import {
  createOwnerDataSource,
  ensureSchema,
} from './helpers/database.js';
import { readDatabaseState } from './helpers/state.js';

/**
 * Pricing and shipments against a real PostGIS database: quotes measure the
 * haversine distance between stored coordinates, shipments persist with
 * their items and append-only status history, every transition bumps the
 * version in the same transaction, the runtime role cannot rewrite history,
 * and cross-tenant reads stay empty under RLS.
 */
describe('Pricing and shipments (integration)', () => {
  let app: INestApplication;
  let transactions: TenantTransactionService;
  let rules: PricingRulesService;
  let quotes: QuotesService;
  let customers: CustomersService;
  let drivers: DriversService;
  let shipments: ShipmentsService;
  let owner: DataSource;
  let appDb: DataSource;

  let tenantA: string;
  let tenantB: string;
  let driverId: string;
  let dispatcherUserId: string;

  let actor: { userId: string; role: 'dispatcher' };

  beforeAll(async () => {
    await ensureSchema();
    owner = await createOwnerDataSource();

    const tenants = (await owner.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`,
      ['Pricing A', `pricing-a-${randomUUID()}`, 'Pricing B', `pricing-b-${randomUUID()}`],
    )) as Array<{ id: string }>;
    [tenantA, tenantB] = tenants.map((row) => row.id);

    // History rows reference the acting user, so seed a real one.
    const userRows = (await owner.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`dispatcher-${randomUUID()}@example.com`],
    )) as Array<{ id: string }>;
    dispatcherUserId = userRows[0].id;
    actor = { userId: dispatcherUserId, role: 'dispatcher' };

    process.env.DATABASE_URL = readDatabaseState().appUrl;
    process.env.JWT_ACCESS_SECRET = 'integration-test-access-secret-min-32-chars';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
        DatabaseModule,
        TenancyModule,
        MessagingModule,
        IdentityModule,
        TenantsModule,
        CustomersModule,
        FleetModule,
        DriversModule,
        PricingModule,
        ShipmentsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    transactions = app.get(TenantTransactionService);
    rules = app.get(PricingRulesService);
    quotes = app.get(QuotesService);
    customers = app.get(CustomersService);
    drivers = app.get(DriversService);
    shipments = app.get(ShipmentsService);
    appDb = app.get(DataSource);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (owner?.isInitialized) {
      await owner.destroy();
    }
  });

  /** Seeds a customer with two geocoded addresses in the given tenant. */
  async function seedAddresses(tenantId: string) {
    return transactions.runWithTenant(tenantId, async () => {
      const customer = await customers.createCustomer(tenantId, {
        name: 'Acme Warehousing',
      });
      const pickup = await customers.createAddress(tenantId, customer.id, {
        line1: '14 Warehouse Road',
        city: 'Lagos',
        country: 'NG',
        latitude: 6.5244,
        longitude: 3.3792,
      });
      const dropoff = await customers.createAddress(tenantId, customer.id, {
        line1: '1 Independence Way',
        city: 'Abuja',
        country: 'NG',
        latitude: 9.0579,
        longitude: 7.4951,
      });
      return { customerId: customer.id, pickup, dropoff };
    });
  }

  it('prices a quote from stored coordinates and tenant rate cards', async () => {
    const seeded = await seedAddresses(tenantA);

    const quote = await transactions.runWithTenant(tenantA, async () => {
      await rules.create(tenantA, {
        name: 'Standard',
        baseFeeMinor: 50_000,
        perKmMinor: 100_000,
        perKgMinor: 1_000,
        minFeeMinor: 100_000,
      });
      return quotes.quote(tenantA, {
        pickupAddressId: seeded.pickup.id,
        dropoffAddressId: seeded.dropoff.id,
        weightKg: 100,
      });
    });

    // Lagos to Abuja crow flight: the distance came from PostGIS coordinates.
    expect(quote.distanceMeters).toBeGreaterThan(520_000);
    expect(quote.distanceMeters).toBeLessThan(545_000);
    expect(quote.priceMinor).toBe(
      quote.baseFeeMinor + quote.distanceFeeMinor + quote.weightFeeMinor,
    );
    expect(quote.priceMinor).toBeGreaterThanOrEqual(quote.minFeeMinor);
    expect(quote.currency).toBe('NGN');
  });

  it('refuses to quote a tenant with no active rate card', async () => {
    const seeded = await seedAddresses(tenantB);
    await expect(
      transactions.runWithTenant(tenantB, () =>
        quotes.quote(tenantB, {
          pickupAddressId: seeded.pickup.id,
          dropoffAddressId: seeded.dropoff.id,
          weightKg: 10,
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'NO_ACTIVE_PRICING_RULE' } });
  });

  it('persists the shipment, its items, and the creation history row', async () => {
    const seeded = await seedAddresses(tenantA);

    const created = await transactions.runWithTenant(tenantA, () =>
      shipments.create(actor, tenantA, {
        customerId: seeded.customerId,
        pickupAddressId: seeded.pickup.id,
        dropoffAddressId: seeded.dropoff.id,
        weightKg: 120,
        items: [{ description: 'Cartons', quantity: 10, weightKg: 120 }],
      }),
    );

    const rows = (await owner.query(
      `SELECT status, price_minor, currency, failed_attempts, version
         FROM shipments WHERE id = $1`,
      [created.id],
    )) as Array<{
      status: string;
      price_minor: number;
      currency: string;
      failed_attempts: number;
      version: number;
    }>;
    expect(rows[0]).toMatchObject({
      status: 'CREATED',
      currency: 'NGN',
      failed_attempts: 0,
      version: 1,
    });
    expect(Number(rows[0].price_minor)).toBe(created.priceMinor);

    const items = (await owner.query(
      `SELECT description, quantity FROM shipment_items WHERE shipment_id = $1`,
      [created.id],
    )) as Array<{ description: string; quantity: number }>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ description: 'Cartons', quantity: 10 });

    const history = (await owner.query(
      `SELECT from_status, to_status, actor_id FROM shipment_status_history
        WHERE shipment_id = $1`,
      [created.id],
    )) as Array<{ from_status: string | null; to_status: string; actor_id: string }>;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from_status: null, to_status: 'CREATED' });
    expect(history[0].actor_id).toBe(actor.userId);
  });

  it('walks a shipment to DELIVERED, bumping the version and appending history', async () => {
    const seeded = await seedAddresses(tenantA);

    // A driver profile in this tenant, so the assignment validates.
    const users = (await owner.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [`driver-${randomUUID()}@example.com`],
    )) as Array<{ id: string }>;
    const memberships = (await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'driver') RETURNING id`,
      [tenantA, users[0].id],
    )) as Array<{ id: string }>;
    const profile = await transactions.runWithTenant(tenantA, () =>
      drivers.createDriver(tenantA, {
        membershipId: memberships[0].id,
        licenseNo: `DL-${randomUUID().slice(0, 8)}`,
      }),
    );
    driverId = profile.id;

    const delivery = await transactions.runWithTenant(tenantA, async () => {
      const shipment = await shipments.create(actor, tenantA, {
        customerId: seeded.customerId,
        pickupAddressId: seeded.pickup.id,
        dropoffAddressId: seeded.dropoff.id,
        weightKg: 5,
      });
      const id = shipment.id;
      let version = shipment.version;
      const step = async (run: (expected: number) => Promise<unknown>) => {
        const next = await run(version);
        version = (next as { version: number }).version;
      };

      await step((expected) => shipments.confirm(actor, tenantA, id, expected));
      await step((expected) =>
        shipments.assign(actor, tenantA, id, expected, driverId, null),
      );
      await step((expected) => shipments.pickup(actor, tenantA, id, expected));
      await step((expected) => shipments.startTransit(actor, tenantA, id, expected));
      await step((expected) => shipments.startDelivery(actor, tenantA, id, expected));
      await step((expected) => shipments.deliver(actor, tenantA, id, expected));
      return { id, version };
    });

    expect(delivery.version).toBe(7); // created at 1, six transitions after

    const rows = (await owner.query(
      `SELECT status, version FROM shipments WHERE id = $1`,
      [delivery.id],
    )) as Array<{ status: string; version: number }>;
    expect(rows[0]).toMatchObject({ status: 'DELIVERED', version: 7 });

    const history = (await owner.query(
      `SELECT to_status FROM shipment_status_history
        WHERE shipment_id = $1 ORDER BY occurred_at, to_status`,
      [delivery.id],
    )) as Array<{ to_status: string }>;
    expect(history.map((row) => row.to_status)).toEqual([
      'CREATED',
      'CONFIRMED',
      'ASSIGNED',
      'PICKED_UP',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]);
  });

  it('records a failed attempt and increments the counter', async () => {
    const seeded = await seedAddresses(tenantA);
    const id = await transactions.runWithTenant(tenantA, async () => {
      const shipment = await shipments.create(actor, tenantA, {
        customerId: seeded.customerId,
        pickupAddressId: seeded.pickup.id,
        dropoffAddressId: seeded.dropoff.id,
        weightKg: 5,
      });
      let version = shipment.version;
      const confirm = await shipments.confirm(actor, tenantA, shipment.id, version);
      version = confirm.version;
      await shipments.assign(actor, tenantA, shipment.id, version, driverId, null);
      return shipment.id;
    });

    // Drive it forward, fail it once, and check the persisted counter.
    await transactions.runWithTenant(tenantA, async () => {
      const current = await shipments.get(actor, tenantA, id);
      let version = current.version;
      const pickup = await shipments.pickup(actor, tenantA, id, version);
      version = pickup.version;
      const transit = await shipments.startTransit(actor, tenantA, id, version);
      version = transit.version;
      const out = await shipments.startDelivery(actor, tenantA, id, version);
      version = out.version;
      const failed = await shipments.fail(
        actor,
        tenantA,
        id,
        version,
        'nobody home',
      );
      expect(failed.status).toBe('FAILED_ATTEMPT');
    });

    const rows = (await owner.query(
      `SELECT status, failed_attempts FROM shipments WHERE id = $1`,
      [id],
    )) as Array<{ status: string; failed_attempts: number }>;
    expect(rows[0]).toMatchObject({
      status: 'FAILED_ATTEMPT',
      failed_attempts: 1,
    });

    const reasons = (await owner.query(
      `SELECT reason FROM shipment_status_history
        WHERE shipment_id = $1 AND to_status = 'FAILED_ATTEMPT'`,
      [id],
    )) as Array<{ reason: string }>;
    expect(reasons[0].reason).toBe('nobody home');
  });

  it('lets the runtime role insert history but never rewrite it', async () => {
    await expect(
      appDb.query(`UPDATE shipment_status_history SET reason = 'tampered'`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      appDb.query(`DELETE FROM shipment_status_history`),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('hides shipments from a foreign tenant under RLS', async () => {
    const seeded = await seedAddresses(tenantA);
    const created = await transactions.runWithTenant(tenantA, () =>
      shipments.create(actor, tenantA, {
        customerId: seeded.customerId,
        pickupAddressId: seeded.pickup.id,
        dropoffAddressId: seeded.dropoff.id,
        weightKg: 5,
      }),
    );

    await transactions.runWithTenant(tenantB, async () => {
      await expect(shipments.get(actor, tenantB, created.id)).rejects.toMatchObject({
        response: { code: 'SHIPMENT_NOT_FOUND' },
      });
      expect(await shipments.list(actor, tenantB)).toHaveLength(0);
    });
  });
});
