import { CompanyAgent } from './bots/company.js';
import { DispatcherAgent } from './bots/dispatcher.js';
import { DriverAgent, type DeliveryOutcome } from './bots/driver.js';
import type { BotConfig, SeededCompany } from './config.js';
import { Logger, sleep } from './logger.js';

export interface ScenarioResult {
  company: string;
  slug: string;
  round: number;
  ok: boolean;
  trackingNumber?: string;
  status: string;
  outcome?: DeliveryOutcome;
  error?: string;
}

/** Rolls the outcome for one shipment from the configured failure rates. */
function pickOutcome(failureRate: number, returnRate: number): DeliveryOutcome {
  const roll = Math.random();
  if (roll < returnRate) return 'return';
  if (roll < returnRate + failureRate) return 'recover';
  return 'deliver';
}

/**
 * Runs one complete, realistic shipment lifecycle for a single demo company:
 *
 *   admin books + confirms → dispatcher offers to a driver → driver accepts,
 *   streams GPS, captures proof of delivery and completes the shipment.
 *
 * Work is rotated across the company's drivers one round at a time: only the
 * driver whose turn it is goes on shift, so every driver sees shipments
 * instead of the same lowest-id driver absorbing them all.
 *
 * Each shipment may take a failure path (see {@link BotConfig.failureRate}) so
 * the FAILED_ATTEMPT, retry and RETURNED transitions are exercised too.
 *
 * Every call goes through the public HTTP API exactly as a real integrator's
 * client would — no database shortcuts.
 */
export async function runCompanyScenario(
  company: SeededCompany,
  config: BotConfig,
  round: number,
): Promise<ScenarioResult> {
  const log = new Logger(`${company.slug}:scenario`, 'blue');
  const base = { company: company.name, slug: company.slug, round };

  try {
    // 1. The company's back office books a shipment.
    const admin = new CompanyAgent(company, config.apiBaseUrl, config.password);
    await admin.connect();

    const plan = admin.planShipment();
    await admin.requestQuote(plan);
    let shipment = await admin.createShipment(plan);
    shipment = await admin.confirm(shipment);

    // 2. One driver is on shift this round; the rest are explicitly off so
    //    dispatch can only offer the job to the driver whose turn it is. The
    //    offset advances with the clock across scheduled runs, so a one-round
    //    tick still spreads work across the fleet.
    const driverCount = company.drivers.length;
    const onDuty =
      driverCount === 0 ? -1 : (config.rotationOffset + (round - 1)) % driverCount;
    const drivers: DriverAgent[] = [];
    for (const [index, driver] of company.drivers.entries()) {
      const agent = new DriverAgent(company, driver.email, config.apiBaseUrl, config.password, index);
      await agent.connect(index === onDuty ? 'available' : 'unavailable');
      drivers.push(agent);
    }

    // 3. The dispatcher offers the shipment to the best candidate.
    const dispatcher = new DispatcherAgent(company, config.apiBaseUrl, config.password);
    await dispatcher.connect();
    const offer = await dispatcher.offer(shipment);
    if (!offer) {
      return { ...base, ok: false, status: shipment.status, error: 'no available driver' };
    }

    // 4. The targeted driver accepts and completes the run.
    const driverBot = drivers.find((d) => d.driverId === offer.driverId);
    if (!driverBot) {
      return {
        ...base,
        ok: false,
        status: shipment.status,
        error: 'dispatcher chose a driver with no running bot',
      };
    }

    const outcome = pickOutcome(config.failureRate, config.returnRate);
    await sleep(400);
    let result = await driverBot.accept(offer.assignmentId, shipment.id);
    result = await driverBot.completeDelivery(result, plan.pickup, plan.dropoff, outcome);

    // A 'return' outcome leaves the shipment at FAILED_ATTEMPT; only a
    // dispatcher may close it out.
    if (outcome === 'return') {
      result = await dispatcher.returnShipment(result, 'Customer unreachable after repeated attempts');
    }

    const finished = result.status === 'DELIVERED' || result.status === 'RETURNED';
    log.ok(`lifecycle complete`, `${result.trackingNumber} → ${result.status}`);
    return {
      ...base,
      ok: finished,
      trackingNumber: result.trackingNumber,
      status: result.status,
      outcome,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('scenario failed', message);
    return { ...base, ok: false, status: 'FAILED', error: message };
  }
}
