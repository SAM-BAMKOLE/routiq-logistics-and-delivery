import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { Logger, sleep } from './logger.js';
import { runCompanyScenario, type ScenarioResult } from './scenario.js';

/**
 * Entry point for the Routiq bot fleet.
 *
 *   pnpm simulate                       # one lifecycle per company
 *   pnpm simulate --rounds 5            # five rounds, 15s apart
 *   pnpm simulate --companies swift-express
 *   pnpm simulate --rounds 0            # loop until Ctrl+C
 *   pnpm simulate --warmup 300          # wait up to 5min for a cold host
 */
const { values } = parseArgs({
  options: {
    companies: { type: 'string' },
    rounds: { type: 'string' },
    interval: { type: 'string' },
    warmup: { type: 'string' },
    parallel: { type: 'boolean' },
    'failure-rate': { type: 'string' },
    'return-rate': { type: 'string' },
    'rotation-offset': { type: 'string' },
  },
});

const intervalSeconds = Number(values.interval ?? process.env.ROUTIQ_BOT_INTERVAL_SECONDS ?? 15);
const roundsArg = Number(values.rounds ?? process.env.ROUTIQ_BOT_ROUNDS ?? 1);
const infinite = Number.isNaN(roundsArg) || roundsArg <= 0;
const parallel = values.parallel ?? false;

/**
 * How long to wait for the API to answer before giving up, in seconds. A host
 * that spun down takes tens of seconds to boot, and the first request is
 * expected to fail; the warm-up absorbs that instead of ending the run.
 */
const warmupSeconds = Math.max(
  0,
  Number(values.warmup ?? process.env.ROUTIQ_BOT_WARMUP_SECONDS ?? 300),
);

async function main(): Promise<void> {
  const config = loadConfig({
    failureRate: optionalRate(values['failure-rate']),
    returnRate: optionalRate(values['return-rate']),
    rotationOffset: optionalInt(values['rotation-offset']),
  });
  const log = new Logger('routiq-bots', 'magenta');

  const wanted = values.companies
    ? new Set(values.companies.split(',').map((s) => s.trim()))
    : null;
  const companies = wanted
    ? config.companies.filter((c) => wanted.has(c.slug))
    : config.companies;

  if (companies.length === 0) {
    throw new Error(
      `No companies matched. Seeded: ${config.companies.map((c) => c.slug).join(', ')}`,
    );
  }

  await waitForApi(config.apiBaseUrl, log);

  log.info(`API → ${config.apiBaseUrl}`);
  log.info(
    `companies: ${companies.map((c) => c.slug).join(', ')}`,
    `${infinite ? 'looping' : `${roundsArg} round(s)`}, ${companies.reduce((n, c) => n + c.drivers.length, 0)} drivers`,
  );
  log.info(
    'failure simulation',
    `failureRate=${config.failureRate} returnRate=${config.returnRate} rotationOffset=${config.rotationOffset}`,
  );

  let stopped = false;
  process.on('SIGINT', () => {
    log.warn('stopping after the current round…');
    stopped = true;
  });

  const results: ScenarioResult[] = [];
  let round = 0;

  while (!stopped && (infinite || round < roundsArg)) {
    round += 1;
    log.step(`round ${round}${infinite ? '' : `/${roundsArg}`}`);

    const roundResults = parallel
      ? await Promise.all(companies.map((c) => runCompanyScenario(c, config, round)))
      : await (async () => {
          const acc: ScenarioResult[] = [];
          for (const company of companies) {
            acc.push(await runCompanyScenario(company, config, round));
          }
          return acc;
        })();

    results.push(...roundResults);

    const more = infinite || round < roundsArg;
    if (more && !stopped && intervalSeconds > 0) {
      log.info(`waiting ${intervalSeconds}s before the next round`);
      await sleep(intervalSeconds * 1_000);
    }
  }

  printSummary(results, log);
}

/**
 * Polls the health endpoint until the API answers, tolerating a sleeping host.
 *
 * A cold start is not an error: the first probe fails while the instance boots
 * and a later one succeeds, so we keep probing for up to `warmupSeconds` and
 * only give up when the budget is spent. Giving up exits non-zero so the
 * scheduler re-runs later; it does not stop anything already running.
 */
async function waitForApi(baseUrl: string, log: Logger): Promise<void> {
  const healthUrl = new URL(baseUrl);
  healthUrl.pathname = '/health/live';
  healthUrl.search = '';

  const deadline = Date.now() + warmupSeconds * 1_000;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        if (attempt > 1) log.ok(`API awake`, `after ${attempt - 1} cold-start probe(s)`);
        return;
      }
      log.warn(`API not ready yet (status ${response.status})`, `probe ${attempt}`);
    } catch (error) {
      log.warn('API not reachable yet', `probe ${attempt}: ${describe(error)}`);
    }

    if (Date.now() >= deadline) {
      log.error(`API still not reachable after ${warmupSeconds}s; ending this run`);
      log.info('A later scheduled run will retry once the host has spun up.');
      process.exit(1);
    }
    await sleep(Math.min(2_000 * attempt, 15_000));
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parses an optional 0..1 CLI rate; `undefined` when the flag is absent. */
function optionalRate(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : undefined;
}

/** Parses an optional non-negative integer CLI flag; `undefined` when absent. */
function optionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function printSummary(results: ScenarioResult[], log: Logger): void {
  const passed = results.filter((r) => r.ok).length;
  const delivered = results.filter((r) => r.status === 'DELIVERED').length;
  const returned = results.filter((r) => r.status === 'RETURNED').length;
  console.log('');
  log.info(
    `summary: ${passed}/${results.length} lifecycles completed`,
    `${delivered} delivered · ${returned} returned`,
  );
  for (const result of results) {
    const icon = result.ok ? '✓' : '✗';
    const outcome = result.outcome ? ` [${result.outcome}]` : '';
    const detail = result.error ? ` (${result.error})` : ` ${result.trackingNumber ?? ''}`;
    console.log(`   ${icon} ${result.company} [round ${result.round}] → ${result.status}${outcome}${detail}`);
  }
}

await main();
