import 'reflect-metadata';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

/** Real PostGIS — the same engine as production, not an in-memory stand-in. */
const POSTGIS_IMAGE = 'postgis/postgis:16-3.4';

/**
 * Handoff file between this setup (main process) and the test workers (child
 * processes). Jest workers do not inherit `process.env` mutations made here, so
 * the connection details are written to disk instead.
 *
 * Computed inline rather than imported from `helpers/paths.ts`: Jest's ESM
 * loader does not apply `moduleNameMapper` to globalSetup, so a relative `.js`
 * import would fail to resolve. The test-side helpers resolve to the same path.
 */
const STATE_FILE = fileURLToPath(
  new URL('./.runtime-state.json', import.meta.url),
);

/**
 * Boots one PostGIS container for the whole integration run and publishes its
 * connection details for the test workers (which apply the migrations through
 * `ensureSchema`). The container id is recorded so `globalTeardown` can stop it
 * from a separate module — Jest does not use a value returned from globalSetup.
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

  const appUrl = new URL(ownerUrl);
  appUrl.username = 'ldms_app';
  appUrl.password = 'ldms_app';

  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        ownerUrl,
        appUrl: appUrl.toString(),
        database: container.getDatabase(),
        containerId: container.getId(),
      },
      null,
      2,
    ),
  );
}
