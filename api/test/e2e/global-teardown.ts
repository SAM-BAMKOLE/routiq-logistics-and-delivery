import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getContainerRuntimeClient } from 'testcontainers';

/**
 * Stops the PostGIS container started by the e2e globalSetup. Self-contained:
 * Jest's ESM loader does not apply `moduleNameMapper` to global hooks.
 */
const STATE_FILE = fileURLToPath(
  new URL('../.runtime-state.json', import.meta.url),
);

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STATE_FILE)) {
    return;
  }

  const { containerId } = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as {
    containerId?: string;
  };

  if (containerId) {
    const client = await getContainerRuntimeClient();
    const container = client.container.getById(containerId);
    await client.container.stop(container, { timeout: 5 }).catch(() => undefined);
    await client.container
      .remove(container, { removeVolumes: true })
      .catch(() => undefined);
  }

  rmSync(STATE_FILE, { force: true });
}