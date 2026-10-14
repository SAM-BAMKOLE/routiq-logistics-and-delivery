import { CompanyAgent } from './bots/company.js';
import { DispatcherAgent } from './bots/dispatcher.js';
import { DriverAgent } from './bots/driver.js';
import type { BotConfig, SeededCompany } from './config.js';
import { Logger, sleep } from './logger.js';

export interface ScenarioResult {
  company: string;
  slug: string;
  round: number;
  ok: boolean;
  trackingNumber?: string;
  status: string;
  error?: string;
}

/**
 * Runs one complete, realistic shipment lifecycle for a single demo company:
 *
 *   admin books + confirms → dispatcher offers to a driver → driver accepts,
 *   streams GPS, captures proof of delivery and completes the shipment.
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

    // 2. All drivers come on shift so they are discoverable.
    const drivers: DriverAgent[] = [];
    for (const [index, driver] of company.drivers.entries()) {
      const agent = new DriverAgent(company, driver.email, config.apiBaseUrl, config.password, index);
      await agent.connect();
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

    await sleep(400);
    const assigned = await driverBot.accept(offer.assignmentId, shipment.id);
    const delivered = await driverBot.completeDelivery(assigned, plan.pickup, plan.dropoff);

    log.ok(`lifecycle complete`, `${delivered.trackingNumber} → ${delivered.status}`);
    return {
      ...base,
      ok: delivered.status === 'DELIVERED',
      trackingNumber: delivered.trackingNumber,
      status: delivered.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('scenario failed', message);
    return { ...base, ok: false, status: 'FAILED', error: message };
  }
}
