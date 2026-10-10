/**
 * Creates the first platform admin.
 *
 * Platform administration is JWT-based, so there is no shared secret to
 * bootstrap from — someone must exist in `users` with `is_platform_admin`
 * first. Run once per environment:
 *
 *   pnpm db:seed:platform-admin --email ops@example.com --password '…'
 *
 * Connects as the table owner (`MIGRATION_DATABASE_URL`), like migrations do.
 * The application itself never runs this; it only logs in as the created user.
 */
import { parseArgs } from 'node:util';
import { hash } from 'argon2';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../src/database/database.options.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    name: { type: 'string' },
  },
});

const email = values.email?.trim().toLowerCase();
const password = values.password ?? '';
const name = values.name?.trim() || null;

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('Provide a valid --email.');
}
if (password.length < 8) {
  throw new Error('Provide a --password of at least 8 characters.');
}

const url = process.env.MIGRATION_DATABASE_URL?.trim();
if (!url) {
  throw new Error(
    'MIGRATION_DATABASE_URL must be set (see .env.example).',
  );
}

const dataSource = new DataSource(buildDataSourceOptions(url));
await dataSource.initialize();
try {
  const existing = (await dataSource.query(
    `SELECT id, is_platform_admin FROM users WHERE email = $1`,
    [email],
  )) as Array<{ id: string; is_platform_admin: boolean }>;

  if (existing.length > 0) {
    if (existing[0].is_platform_admin) {
      console.log(`Platform admin ${email} already exists. Nothing to do.`);
    } else {
      await dataSource.query(
        `UPDATE users
            SET is_platform_admin = true,
                password_hash = $2,
                updated_at = now()
          WHERE id = $1`,
        [existing[0].id, await hash(password)],
      );
      console.log(`Promoted ${email} to platform admin and set its password.`);
    }
  } else {
    await dataSource.query(
      `INSERT INTO users (email, password_hash, name, is_platform_admin, email_verified_at)
       VALUES ($1, $2, $3, true, now())`,
      [email, await hash(password), name],
    );
    console.log(`Created platform admin ${email}.`);
  }
} finally {
  await dataSource.destroy();
}
