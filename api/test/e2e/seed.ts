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
    const userRows = (await owner.query(
      `INSERT INTO users (email, password_hash, is_platform_admin)
       VALUES ($1, $2, true), ($3, $2, false), ($4, $2, false)
       RETURNING id`,
      [platformEmail, passwordHash, adminEmail, driverEmail],
    )) as Array<{ id: string }>;

    await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'tenant_admin'), ($3, $2, 'dispatcher'), ($3, $4, 'driver')`,
      [tenants[0].id, userRows[1].id, tenants[1].id, userRows[2].id],
    );

    return {
      tenantA: tenants[0].id,
      tenantB: tenants[1].id,
      platformEmail,
      platformPassword: PASSWORD,
      adminEmail,
      adminPassword: PASSWORD,
      driverEmail,
      driverPassword: PASSWORD,
    };
  } finally {
    if (owner.isInitialized) {
      await owner.destroy();
    }
  }
}
