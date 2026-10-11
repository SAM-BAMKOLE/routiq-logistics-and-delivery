import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Runs in each Jest worker before the test files (and their imports) load.
 * `globalSetup` cannot pass values to workers through `process.env`, so the
 * app-under-test is pointed at the test database via this handoff file.
 */
const STATE_FILE = fileURLToPath(
  new URL('../.runtime-state.json', import.meta.url),
);

const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as {
  appUrl: string;
};

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = state.appUrl;
process.env.JWT_ACCESS_SECRET = 'e2e-test-access-secret-min-32-chars-long';
// Deterministic transport: the suites read delivered mail out of the
// in-memory mailbox, never through SMTP.
process.env.EMAIL_ADAPTER = 'memory';

void state;