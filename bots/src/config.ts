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

export interface SeededVehicle {
  plate: string;
  type: string;
  capacityWeightKg: number;
  capacityVolumeM3: number | null;
}

export interface SeededCompany {
  slug: string;
  name: string;
  admin: { email: string };
  dispatcher: { email: string };
  drivers: Array<{ email: string; licenseNo: string }>;
  vehicles?: SeededVehicle[];
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
  /** Chance a shipment hits a failed delivery attempt before it finishes. */
  failureRate: number;
  /** Chance a shipment ends RETURNED (a failed attempt the dispatcher closes out). */
  returnRate: number;
  /**
   * Rotation seed for driver shifts. Successive scheduled runs each pick up
   * where the last left off, so a single-round CI tick still spreads work
   * across the fleet instead of always starting at driver 1.
   */
  rotationOffset: number;
}

const DEFAULT_MANIFEST = fileURLToPath(new URL('../../api/.demo-seed.json', import.meta.url));

/**
 * How often the fleet exercises the failure paths. A failed attempt is the
 * only way FAILED_ATTEMPT and RETURNED ever appear, so a realistic demo needs
 * some. Most failures recover (retry then deliver); the `returnRate` slice is
 * closed out by the dispatcher instead. Set either to 0 for an all-green run.
 */
const DEFAULT_FAILURE_RATE = 0.25;
const DEFAULT_RETURN_RATE = 0.1;

/**
 * Wall-clock window over which the on-duty driver advances. Matches the CI
 * schedule (every 30 minutes), so each tick puts a different driver on shift.
 */
const DEFAULT_ROTATION_WINDOW_MINUTES = 30;

/**
 * Resolves runtime configuration. The seed manifest is the source of truth for
 * which companies/drivers exist; every field can be overridden by environment
 * variables so the bots can also target a deployed API.
 */
export function loadConfig(
  overrides: Partial<Pick<BotConfig, 'failureRate' | 'returnRate' | 'rotationOffset'>> = {},
): BotConfig {
  // A file path suits local runs; the raw JSON suits CI, where the manifest is
  // a secret and writing a file just to read it back is pointless.
  const inline = process.env.ROUTIQ_SEED_MANIFEST_JSON?.trim();
  const manifestPath = process.env.ROUTIQ_SEED_MANIFEST?.trim() || DEFAULT_MANIFEST;
  const manifest = inline ? parseManifest(inline) : readManifest(manifestPath);

  const apiBaseUrl =
    process.env.ROUTIQ_API_URL?.trim() ||
    manifest?.apiBaseUrl ||
    'http://localhost:3000/api/v1';

  const password =
    process.env.ROUTIQ_DEMO_PASSWORD?.trim() || manifest?.password || 'Passw0rd!demo';

  if (!manifest) {
    throw new Error(
      inline
        ? 'ROUTIQ_SEED_MANIFEST_JSON is set but is not a valid manifest.'
        : `No seed manifest found at ${manifestPath}.\n` +
            'Run `pnpm db:seed:demo` in the api package first, or set ' +
            'ROUTIQ_SEED_MANIFEST (a path) or ROUTIQ_SEED_MANIFEST_JSON (inline JSON).',
    );
  }
  if (manifest.companies.length === 0) {
    throw new Error('The seed manifest contains no companies. Re-run `pnpm db:seed:demo`.');
  }

  return {
    apiBaseUrl,
    password,
    companies: manifest.companies,
    manifestPath,
    failureRate:
      overrides.failureRate ??
      rateFrom(process.env.ROUTIQ_BOT_FAILURE_RATE, DEFAULT_FAILURE_RATE),
    returnRate:
      overrides.returnRate ??
      rateFrom(process.env.ROUTIQ_BOT_RETURN_RATE, DEFAULT_RETURN_RATE),
    rotationOffset:
      overrides.rotationOffset ??
      intFrom(process.env.ROUTIQ_BOT_ROTATION_OFFSET, defaultRotationOffset()),
  };
}

/** Parses a 0..1 probability, clamping out-of-range input and ignoring junk. */
function rateFrom(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

/** Parses a non-negative integer, falling back on junk. */
function intFrom(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * The rotation slot for right now: one increment per rotation window. Deriving
 * it from the clock (rather than a counter) is what lets stateless scheduled
 * runs continue the rotation.
 */
function defaultRotationOffset(): number {
  const windowMinutes = intFrom(
    process.env.ROUTIQ_BOT_ROTATION_WINDOW_MINUTES,
    DEFAULT_ROTATION_WINDOW_MINUTES,
  );
  const windowMs = Math.max(1, windowMinutes) * 60_000;
  return Math.floor(Date.now() / windowMs);
}

function readManifest(path: string): SeedManifest | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SeedManifest;
  } catch {
    return null;
  }
}

function parseManifest(raw: string): SeedManifest | null {
  try {
    return JSON.parse(raw) as SeedManifest;
  } catch {
    return null;
  }
}
