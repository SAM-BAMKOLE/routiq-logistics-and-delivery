import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface SeededAddress {
  id: string;
  label: string;
  city: string;
  lat: number;
  lng: number;
}

export interface SeededCustomer {
  id: string;
  name: string;
  addresses: SeededAddress[];
}

export interface SeededCompany {
  slug: string;
  name: string;
  admin: { email: string };
  dispatcher: { email: string };
  drivers: Array<{ email: string; licenseNo: string }>;
  customers: SeededCustomer[];
}

export interface SeedManifest {
  generatedAt: string;
  apiBaseUrl: string;
  password: string;
  platformAdmin: { email: string; name: string };
  companies: SeededCompany[];
}

export interface BotConfig {
  apiBaseUrl: string;
  password: string;
  companies: SeededCompany[];
  manifestPath: string | null;
}

const DEFAULT_MANIFEST = fileURLToPath(new URL('../../api/.demo-seed.json', import.meta.url));

/**
 * Resolves runtime configuration. The seed manifest is the source of truth for
 * which companies/drivers exist; every field can be overridden by environment
 * variables so the bots can also target a deployed API.
 */
export function loadConfig(): BotConfig {
  const manifestPath = process.env.ROUTIQ_SEED_MANIFEST?.trim() || DEFAULT_MANIFEST;
  const manifest = readManifest(manifestPath);

  const apiBaseUrl =
    process.env.ROUTIQ_API_URL?.trim() ||
    manifest?.apiBaseUrl ||
    'http://localhost:3000/api/v1';

  const password =
    process.env.ROUTIQ_DEMO_PASSWORD?.trim() || manifest?.password || 'Passw0rd!demo';

  if (!manifest) {
    throw new Error(
      `No seed manifest found at ${manifestPath}.\n` +
        'Run `pnpm db:seed:demo` in the api package first, or set ROUTIQ_SEED_MANIFEST.',
    );
  }
  if (manifest.companies.length === 0) {
    throw new Error('The seed manifest contains no companies. Re-run `pnpm db:seed:demo`.');
  }

  return { apiBaseUrl, password, companies: manifest.companies, manifestPath };
}

function readManifest(path: string): SeedManifest | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SeedManifest;
  } catch {
    return null;
  }
}
