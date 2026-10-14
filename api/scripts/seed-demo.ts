/**
 * Provisions a complete, repeatable demo dataset.
 *
 * The API deliberately has no self-service sign-up: tenants are created by a
 * platform admin and the first membership of each tenant is bootstrapped
 * out-of-band. That makes onboarding awkward for demos, so this script is the
 * single, idempotent way to stand up:
 *
 *   - one platform admin
 *   - N demo logistics companies (tenants), each with a tenant admin,
 *     a dispatcher, drivers (with memberships + vehicles) and customers
 *     with saved pickup/dropoff addresses,
 *   - a tenant rate card (pricing rule).
 *
 * It connects as the table owner (`MIGRATION_DATABASE_URL`) like migrations do,
 * and re-runs safely: every write is an upsert keyed on a natural key.
 *
 *   pnpm db:seed:demo
 *   pnpm db:seed:demo --password 'MyPassw0rd!' --companies acme,swift
 *
 * On success it writes a manifest (`.demo-seed.json`, gitignored) that the
 * bots and the frontend can read so credentials never need to be copied by
 * hand.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { hash } from 'argon2';
import { config as loadEnv } from 'dotenv';
import { DataSource, type QueryRunner } from 'typeorm';
import { buildDataSourceOptions } from '../src/database/database.options.js';

loadEnv({ quiet: true });

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEFAULT_PASSWORD = 'Passw0rd!demo';
const PLATFORM_ADMIN_EMAIL = 'ops@routiq.demo';

interface SeedAddress {
  line1: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  lat: number;
  lng: number;
}

interface SeedVehicle {
  plate: string;
  type: 'van' | 'truck' | 'motorcycle' | 'car';
  weightKg: number;
  volumeM3: number;
}

interface SeedDriver {
  key: string;
  licenseNo: string;
}

interface SeedCompany {
  slug: string;
  name: string;
  plan: 'free' | 'growth' | 'enterprise';
  admin: { email: string; name: string };
  dispatcher: { email: string; name: string };
  drivers: SeedDriver[];
  vehicles: SeedVehicle[];
  customers: Array<{
    name: string;
    email: string;
    phone: string;
    addresses: SeedAddress[];
  }>;
  pricing: {
    name: string;
    baseFeeMinor: number;
    perKmMinor: number;
    perKgMinor: number;
    minFeeMinor: number;
    priority: number;
  };
}

const COMPANIES: SeedCompany[] = [
  {
    slug: 'acme-logistics',
    name: 'Acme Logistics',
    plan: 'growth',
    admin: { email: 'admin@acme-logistics.demo', name: 'Ada Okafor' },
    dispatcher: { email: 'dispatch@acme-logistics.demo', name: 'Bola Adeyemi' },
    drivers: [
      { key: 'd1', licenseNo: 'ACME-DRV-0001' },
      { key: 'd2', licenseNo: 'ACME-DRV-0002' },
      { key: 'd3', licenseNo: 'ACME-DRV-0003' },
    ],
    vehicles: [
      { plate: 'ACME-101', type: 'van', weightKg: 1200, volumeM3: 8 },
      { plate: 'ACME-202', type: 'truck', weightKg: 5000, volumeM3: 30 },
      { plate: 'ACME-303', type: 'motorcycle', weightKg: 40, volumeM3: 0.5 },
    ],
    customers: [
      {
        name: 'Lagos Fresh Foods',
        email: 'ops@lagosfresh.demo',
        phone: '+2348010000001',
        addresses: [
          {
            line1: '14 Adeola Odeku Street',
            city: 'Lagos',
            region: 'Lagos',
            country: 'Nigeria',
            postalCode: '101241',
            lat: 6.4281,
            lng: 3.4219,
          },
          {
            line1: '7 Ozumba Mbadiwe Avenue',
            city: 'Lagos',
            region: 'Lagos',
            country: 'Nigeria',
            postalCode: '101241',
            lat: 6.4301,
            lng: 3.4262,
          },
        ],
      },
      {
        name: 'Ikeja Electronics',
        email: 'warehouse@ikejaelectronics.demo',
        phone: '+2348010000002',
        addresses: [
          {
            line1: '22 Obafemi Awolowo Way',
            city: 'Ikeja',
            region: 'Lagos',
            country: 'Nigeria',
            postalCode: '100271',
            lat: 6.6018,
            lng: 3.3515,
          },
          {
            line1: '5 Allen Avenue',
            city: 'Ikeja',
            region: 'Lagos',
            country: 'Nigeria',
            postalCode: '100271',
            lat: 6.5969,
            lng: 3.3506,
          },
        ],
      },
    ],
    pricing: {
      name: 'Acme Standard',
      baseFeeMinor: 50000,
      perKmMinor: 12000,
      perKgMinor: 2000,
      minFeeMinor: 80000,
      priority: 10,
    },
  },
  {
    slug: 'bamko-couriers',
    name: 'Bamko Couriers',
    plan: 'enterprise',
    admin: { email: 'admin@bamko-couriers.demo', name: 'Samuel Bamkole' },
    dispatcher: { email: 'dispatch@bamko-couriers.demo', name: 'Chioma Eze' },
    drivers: [
      { key: 'd1', licenseNo: 'BAM-DRV-0001' },
      { key: 'd2', licenseNo: 'BAM-DRV-0002' },
    ],
    vehicles: [
      { plate: 'BAM-501', type: 'van', weightKg: 1500, volumeM3: 10 },
      { plate: 'BAM-502', type: 'truck', weightKg: 8000, volumeM3: 45 },
    ],
    customers: [
      {
        name: 'Abuja MedSupply',
        email: 'logistics@abujamedical.demo',
        phone: '+2348010000003',
        addresses: [
          {
            line1: 'Plot 1234 Ahmadu Bello Way',
            city: 'Abuja',
            region: 'FCT',
            country: 'Nigeria',
            postalCode: '900211',
            lat: 9.0579,
            lng: 7.4951,
          },
          {
            line1: '18 Ademola Adetokunbo Crescent',
            city: 'Abuja',
            region: 'FCT',
            country: 'Nigeria',
            postalCode: '900211',
            lat: 9.0579,
            lng: 7.4894,
          },
        ],
      },
    ],
    pricing: {
      name: 'Bamko Express',
      baseFeeMinor: 75000,
      perKmMinor: 15000,
      perKgMinor: 2500,
      minFeeMinor: 120000,
      priority: 20,
    },
  },
  {
    slug: 'swift-express',
    name: 'Swift Express',
    plan: 'free',
    admin: { email: 'admin@swift-express.demo', name: 'Tunde Balogun' },
    dispatcher: { email: 'dispatch@swift-express.demo', name: 'Ngozi Umeh' },
    drivers: [{ key: 'd1', licenseNo: 'SWF-DRV-0001' }],
    vehicles: [{ plate: 'SWF-1', type: 'motorcycle', weightKg: 30, volumeM3: 0.4 }],
    customers: [
      {
        name: 'Abuja Retail Hub',
        email: 'logistics@abujaretail.demo',
        phone: '+2348010000003',
        addresses: [
          {
            line1: '10 Ahmadu Bello Way',
            city: 'Abuja',
            region: 'FCT',
            country: 'Nigeria',
            postalCode: '900211',
            lat: 9.0579,
            lng: 7.4951,
          },
          {
            line1: '3 Gana Street',
            city: 'Abuja',
            region: 'FCT',
            country: 'Nigeria',
            postalCode: '900211',
            lat: 9.0551,
            lng: 7.4899,
          },
        ],
      },
    ],
    pricing: {
      name: 'Swift Flat',
      baseFeeMinor: 30000,
      perKmMinor: 9000,
      perKgMinor: 1500,
      minFeeMinor: 50000,
      priority: 5,
    },
  },
];

interface SeedManifest {
  generatedAt: string;
  apiBaseUrl: string;
  password: string;
  platformAdmin: { email: string; name: string };
  companies: Array<{
    slug: string;
    name: string;
    admin: { email: string };
    dispatcher: { email: string };
    drivers: Array<{ email: string; licenseNo: string }>;
    customers: Array<{ id: string; name: string; addresses: Array<{ id: string; label: string; city: string; lat: number; lng: number }> }>;
  }>;
}

// ---- CLI ---------------------------------------------------------------

const { values } = parseArgs({
  options: {
    password: { type: 'string' },
    name: { type: 'string' },
    companies: { type: 'string' },
    'manifest-out': { type: 'string' },
  },
});

const password = values.password ?? 'Passw0rd!demo';
if (password.length < 8) {
  throw new Error('Provide a --password of at least 8 characters.');
}

const selectedSlugs = values.companies
  ? new Set(values.companies.split(',').map((s) => s.trim()))
  : null;
const companies = selectedSlugs
  ? COMPANIES.filter((c) => selectedSlugs.has(c.slug))
  : COMPANIES;
if (companies.length === 0) {
  throw new Error('No matching companies. Known slugs: ' + COMPANIES.map((c) => c.slug).join(', '));
}

const migrationUrl = process.env.MIGRATION_DATABASE_URL?.trim();
if (!migrationUrl) {
  throw new Error('MIGRATION_DATABASE_URL must be set (see .env.example).');
}

const platformAdminEmail = 'ops@routiq.demo';
const platformAdminName = values.name?.trim() || 'Platform Ops';

// ---- Password hashing (cache) ------------------------------------------

const hashCache = new Map<string, string>();
async function passwordHash(secret: string): Promise<string> {
  const cached = hashCache.get(secret);
  if (cached) return cached;
  const hashed = await hash(secret);
  hashCache.set(secret, hashed);
  return hashed;
}

// ---- Data source -------------------------------------------------------

const dataSource = new DataSource(buildDataSourceOptions(migrationUrl));
await dataSource.initialize();
const runner = dataSource.createQueryRunner();
await runner.connect();

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  runner.query(sql, params) as Promise<T[]>;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

async function upsertUser(email: string, name: string, isPlatformAdmin = false): Promise<string> {
  const hashed = await passwordHash(password);
  const row = await one<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, is_platform_admin, email_verified_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           is_platform_admin = EXCLUDED.is_platform_admin,
           updated_at = now()
     RETURNING id`,
    [email, hashed, name, isPlatformAdmin],
  );
  return row!.id;
}

async function upsertTenant(slug: string, name: string, plan: string): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO tenants (slug, name, plan, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           plan = EXCLUDED.plan,
           status = 'active',
           updated_at = now()
     RETURNING id`,
    [slug, name, plan],
  );
  return row!.id;
}

async function upsertMembership(tenantId: string, userId: string, role: string): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO memberships (tenant_id, user_id, role, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (tenant_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active',
           updated_at = now()
     RETURNING id`,
    [tenantId, userId, role],
  );
  return row!.id;
}

async function upsertVehicle(
  tenantId: string,
  v: SeedVehicle,
): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO vehicles (tenant_id, plate, type, capacity_weight_kg, capacity_volume_m3, status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     ON CONFLICT (tenant_id, plate) DO UPDATE
       SET type = EXCLUDED.type,
           capacity_weight_kg = EXCLUDED.capacity_weight_kg,
           capacity_volume_m3 = EXCLUDED.capacity_volume_m3,
           status = 'active',
           updated_at = now()
     RETURNING id`,
    [tenantId, v.plate, v.type, v.weightKg, v.volumeM3],
  );
  return row!.id;
}

async function upsertDriver(
  tenantId: string,
  membershipId: string,
  licenseNo: string,
  currentVehicleId: string | null,
): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO drivers (tenant_id, membership_id, license_no, status, availability, current_vehicle_id)
     VALUES ($1, $2, $3, 'active', 'available', $4)
     ON CONFLICT (tenant_id, membership_id) DO UPDATE
       SET license_no = EXCLUDED.license_no,
           status = 'active',
           availability = 'available',
           current_vehicle_id = EXCLUDED.current_vehicle_id,
           updated_at = now()
     RETURNING id`,
    [tenantId, membershipId, licenseNo, currentVehicleId],
  );
  return row!.id;
}

async function upsertCustomer(
  tenantId: string,
  name: string,
  email: string,
  phone: string,
): Promise<string> {
  const existing = await one<{ id: string }>(
    `SELECT id FROM customers WHERE tenant_id = $1 AND email = $2`,
    [tenantId, email],
  );
  if (existing) return existing.id;
  const row = await one<{ id: string }>(
    `INSERT INTO customers (tenant_id, name, email, phone)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [tenantId, name, email, phone],
  );
  return row!.id;
}

async function upsertAddress(
  tenantId: string,
  customerId: string,
  a: SeedAddress,
): Promise<string> {
  const existing = await one<{ id: string }>(
    `SELECT id FROM addresses WHERE tenant_id = $1 AND customer_id = $2 AND line1 = $3`,
    [tenantId, customerId, a.line1],
  );
  if (existing) {
    await q(
      `UPDATE addresses
          SET city = $3, region = $4, country = $5, postal_code = $6,
              location = ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [existing.id, tenantId, a.city, a.region, a.country, a.postalCode, a.lng, a.lat],
    );
    return existing.id;
  }
  const row = await one<{ id: string }>(
    `INSERT INTO addresses (tenant_id, customer_id, line1, city, region, country, postal_code, location)
     VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography)
     RETURNING id`,
    [tenantId, customerId, a.line1, a.city, a.region, a.country, a.postalCode, a.lng, a.lat],
  );
  return row!.id;
}

async function upsertPricingRule(tenantId: string, p: SeedCompany['pricing']): Promise<void> {
  const existing = await one<{ id: string }>(
    `SELECT id FROM pricing_rules WHERE tenant_id = $1 AND name = $2`,
    [tenantId, p.name],
  );
  if (existing) {
    await q(
      `UPDATE pricing_rules
          SET base_fee_minor = $3, per_km_minor = $4, per_kg_minor = $5,
              min_fee_minor = $6, priority = $7, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [existing.id, tenantId, p.baseFeeMinor, p.perKmMinor, p.perKgMinor, p.minFeeMinor, p.priority],
    );
    return;
  }
  await q(
    `INSERT INTO pricing_rules (tenant_id, name, base_fee_minor, per_km_minor, per_kg_minor, min_fee_minor, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, p.name, p.baseFeeMinor, p.perKmMinor, p.perKgMinor, p.minFeeMinor, p.priority],
  );
}

// ---- Run ---------------------------------------------------------------

const manifest: SeedManifest = {
  generatedAt: new Date().toISOString(),
  apiBaseUrl:
    process.env.ROUTIQ_API_URL?.trim() ||
    `http://localhost:${process.env.PORT?.trim() || '3000'}/api/v1`,
  password,
  platformAdmin: { email: platformAdminEmail, name: platformAdminName },
  companies: [],
};

try {
  await runner.startTransaction();

  await upsertUser(platformAdminEmail, platformAdminName, true);
  console.log(`Platform admin ready: ${platformAdminEmail}`);

  for (const company of companies) {
    const tenantId = await upsertTenant(company.slug, company.name, company.plan);
    // Set the RLS tenant context so inserts to tenant-scoped tables pass even
    // when connected as a role that does not bypass RLS.
    await q(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    const adminId = await upsertUser(company.admin.email, company.admin.name);
    await upsertMembership(tenantId, adminId, 'tenant_admin');

    const dispatcherId = await upsertUser(company.dispatcher.email, company.dispatcher.name);
    await upsertMembership(tenantId, dispatcherId, 'dispatcher');

    // Vehicles, then drivers bound to them.
    const vehicleIds: string[] = [];
    for (const vehicle of company.vehicles) {
      vehicleIds.push(await upsertVehicle(tenantId, vehicle));
    }

    const driverManifest: Array<{ email: string; licenseNo: string }> = [];
    for (const [index, driver] of company.drivers.entries()) {
      const email = `driver${index + 1}@${company.slug}.demo`;
      const userId = await upsertUser(email, `Driver ${index + 1} (${company.name})`);
      const membershipId = await upsertMembership(tenantId, userId, 'driver');
      await upsertDriver(
        tenantId,
        membershipId,
        driver.licenseNo,
        vehicleIds[index % vehicleIds.length] ?? null,
      );
      driverManifest.push({ email, licenseNo: driver.licenseNo });
    }

    const customerManifest: SeedManifest['companies'][number]['customers'] = [];
    for (const customer of company.customers) {
      const customerId = await upsertCustomer(
        tenantId,
        customer.name,
        customer.email,
        customer.phone,
      );
      const addresses: Array<{ id: string; label: string; city: string; lat: number; lng: number }> = [];
      for (const address of customer.addresses) {
        const addressId = await upsertAddress(tenantId, customerId, address);
        addresses.push({ id: addressId, label: address.line1, city: address.city, lat: address.lat, lng: address.lng });
      }
      customerManifest.push({ id: customerId, name: customer.name, addresses });
    }

    await upsertPricingRule(tenantId, company.pricing);

    manifest.companies.push({
      slug: company.slug,
      name: company.name,
      admin: { email: company.admin.email },
      dispatcher: { email: company.dispatcher.email },
      drivers: driverManifest,
      customers: customerManifest,
    });

    console.log(
      `Tenant ready: ${company.name} (${company.slug}) — admin ${company.admin.email}, ` +
        `${company.drivers.length} drivers, ${company.customers.length} customers`,
    );
  }

  await runner.commitTransaction();
} catch (error) {
  await runner.rollbackTransaction();
  throw error;
} finally {
  await runner.release();
  await dataSource.destroy();
}

const manifestPath =
  values['manifest-out'] ?? fileURLToPath(new URL('../.demo-seed.json', import.meta.url));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

console.log('');
console.log('──────────────────────────────────────────────');
console.log(' Demo seed complete');
console.log('──────────────────────────────────────────────');
console.log(` Password (all accounts): ${password}`);
console.log(` Manifest: ${manifestPath}`);
console.log(' Login example:');
console.log(`   POST /api/v1/auth/login { "email": "${manifest.companies[0]?.admin.email}", "password": "${password}" }`);
console.log('──────────────────────────────────────────────');
