import { ensureSchema } from '../integration/helpers/database.js';

/**
 * Shared DB setup for every e2e spec: provisions the runtime role and applies
 * the migrations once (idempotent) before the first test runs. This must
 * happen before any `beforeAll` that builds the Nest application.
 */
beforeAll(async () => {
  await ensureSchema();
}, 120000);