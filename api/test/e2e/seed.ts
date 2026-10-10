import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Argon2PasswordHasher } from '../../src/modules/identity/infrastructure/argon2-password-hasher.js';
import { createOwnerDataSource } from '../integration/helpers/database.js';

/**
 * Seeds users, tenants, and memberships straight into the e2e database as the
 * table owner. Each call uses unique emails/slugs, so suites sharing one
 * container never collide.
 */
export interface E2EAuthFixture {
  tenantA: string;
  tenantB: string;
  platformEmail: string;
  platformPassword: string;
  adminEmail: string;
  adminPassword: string;
  driverEmail: string;
  driverPassword: string;
  /** Second admin, tenant_admin in tenant B (for tenant-B management flows). */
  opsBEmail: string;
  opsBPassword: string;
  /** Driver profile id for the driver membership in tenant B. */
  driverBId: string;
  /** Vehicle id in tenant B (for assignment checks). */
  vehicleBId: string;
  /** Portal customer (role customer) in tenant B with a linked profile. */
  customerEmail: string;
  customerPassword: string;
  customerId: string;
  /** The customer's two saved addresses in tenant B (geocoded). */
  pickupAddressId: string;
  dropoffAddressId: string;
}

const PASSWORD = 'Password-123';

export async function seedAuthFixture(): Promise<E2EAuthFixture> {
  const owner: DataSource = await createOwnerDataSource();
  try {
    const hasher = new Argon2PasswordHasher();
    const passwordHash = await hasher.hash(PASSWORD);
    const tag = randomUUID();

    const tenants = (await owner.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`,
      [`E2E Tenant A ${tag}`, `e2e-a-${tag}`, `E2E Tenant B ${tag}`, `e2e-b-${tag}`],
    )) as Array<{ id: string }>;

    const platformEmail = `platform-${tag}@example.com`;
    const adminEmail = `admin-${tag}@example.com`;
    const driverEmail = `driver-${tag}@example.com`;
    const opsBEmail = `ops-b-${tag}@example.com`;
    const customerEmail = `customer-${tag}@example.com`;
    const userRows = (await owner.query(
      `INSERT INTO users (email, password_hash, is_platform_admin)
       VALUES ($1, $2, true), ($3, $2, false), ($4, $2, false), ($5, $2, false),
              ($6, $2, false)
       RETURNING id`,
      [platformEmail, passwordHash, adminEmail, driverEmail, opsBEmail, customerEmail],
    )) as Array<{ id: string }>;

    const membershipRows = (await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'tenant_admin'), ($3, $2, 'dispatcher'), ($3, $4, 'driver'),
              ($3, $5, 'tenant_admin'), ($3, $6, 'customer')
       RETURNING id`,
      [tenants[0].id, userRows[1].id, tenants[1].id, userRows[2].id, userRows[3].id, userRows[4].id],
    )) as Array<{ id: string }>;

    const vehicleRows = (await owner.query(
      `INSERT INTO vehicles (tenant_id, plate, type, capacity_weight_kg, capacity_volume_m3)
       VALUES ($1, $2, 'van', 1500, 12)
       RETURNING id`,
      [tenants[1].id, `E2E-${tag.slice(0, 8)}`],
    )) as Array<{ id: string }>;

    const driverRows = (await owner.query(
      `INSERT INTO drivers (tenant_id, membership_id, license_no, current_vehicle_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [tenants[1].id, membershipRows[2].id, `DL-${tag.slice(0, 8)}`, vehicleRows[0].id],
    )) as Array<{ id: string }>;

    // A portal customer in tenant B with a linked profile and two geocoded
    // addresses, so quotes and shipment creation work without extra setup.
    const customerRows = (await owner.query(
      `INSERT INTO customers (tenant_id, user_id, name)
       VALUES ($1, $2, 'Portal Customer')
       RETURNING id`,
      [tenants[1].id, userRows[4].id],
    )) as Array<{ id: string }>;
    const addressRows = (await owner.query(
      `INSERT INTO addresses (tenant_id, customer_id, line1, city, country, location)
       VALUES ($1, $2, '14 Warehouse Road', 'Lagos', 'NG',
               ST_SetSRID(ST_MakePoint(3.3792, 6.5244), 4326)::geography),
              ($1, $2, '1 Independence Way', 'Abuja', 'NG',
               ST_SetSRID(ST_MakePoint(7.4951, 9.0579), 4326)::geography)
       RETURNING id`,
      [tenants[1].id, customerRows[0].id],
    )) as Array<{ id: string }>;

    return {
      tenantA: tenants[0].id,
      tenantB: tenants[1].id,
      platformEmail,
      platformPassword: PASSWORD,
      adminEmail,
      adminPassword: PASSWORD,
      driverEmail,
      driverPassword: PASSWORD,
      opsBEmail,
      opsBPassword: PASSWORD,
      driverBId: driverRows[0].id,
      vehicleBId: vehicleRows[0].id,
      customerEmail,
      customerPassword: PASSWORD,
      customerId: customerRows[0].id,
      pickupAddressId: addressRows[0].id,
      dropoffAddressId: addressRows[1].id,
    };
  } finally {
    if (owner.isInitialized) {
      await owner.destroy();
    }
  }
}
