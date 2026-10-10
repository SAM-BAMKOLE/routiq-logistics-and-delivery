import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getContainerRuntimeClient } from 'testcontainers';

/**
 * Stops the PostGIS container started by globalSetup. Jest runs this as its own
 * module, so the container is looked up by the id recorded in the state file.
 *
 * No relative project imports here: Jest's ESM loader does not apply
 * `moduleNameMapper` to global hooks, so a `.js`-suffixed import would fail.
 */
const STATE_FILE = fileURLToPath(
  new URL('./.runtime-state.json', import.meta.url),
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
