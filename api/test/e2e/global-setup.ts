import 'reflect-metadata';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

/** Real PostGIS — the same engine as production, not an in-memory stand-in. */
const POSTGIS_IMAGE = 'postgis/postgis:16-3.4';

/**
 * Handoff file shared with the integration run (see `helpers/paths.ts`).
 * computed inline: Jest's ESM loader does not apply `moduleNameMapper` to
 * globalSetup, so a relative `.js` import would fail to resolve.
 */
const STATE_FILE = fileURLToPath(
  new URL('../.runtime-state.json', import.meta.url),
);

/**
 * Boots one PostGIS container for the whole e2e run, so the application's
 * TypeORM connection has a real database to talk to. The container id is
 * recorded so `globalTeardown` can stop it.
 */
export default async function globalSetup(): Promise<void> {
  if (existsSync(STATE_FILE)) {
    rmSync(STATE_FILE, { force: true });
  }

  const container = await new PostgreSqlContainer(POSTGIS_IMAGE)
    .withDatabase('ldms_test')
    .withUsername('ldms_owner')
    .withPassword('ldms_owner')
    .start();

  const ownerUrl = container.getConnectionUri();

  // Single-role deployment: the application connects as the same role that
  // owns the schema. Tenant isolation lives in the application layer, so there
  // is no separate restricted runtime role to provision.
  const appUrl = ownerUrl;

  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        ownerUrl,
        appUrl,
        database: container.getDatabase(),
        containerId: container.getId(),
      },
      null,
      2,
    ),
  );
}