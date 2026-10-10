import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Handoff file between globalSetup (main process) and the test workers (child
 * processes). Jest workers do not inherit `process.env` mutations made in
 * globalSetup, so the container's connection details are written here instead.
 */
export const STATE_FILE = join(HERE, '..', '.runtime-state.json');
