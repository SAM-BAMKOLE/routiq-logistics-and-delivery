import type { SeededCompany } from '../config.js';
import { RoutiqClient } from '../http.js';
import { Logger } from '../logger.js';
import type { DispatchCandidate, Shipment } from '../types.js';

/**
 * DispatcherAgent behaves like a company's dispatcher: it picks confirmed
 * shipments, asks the API who is available, and offers the job to the closest
 * driver. The driver's own bot accepts the offer.
 */
export class DispatcherAgent {
  readonly client: RoutiqClient;
  readonly log: Logger;

  constructor(
    private readonly company: SeededCompany,
    baseUrl: string,
    private readonly password: string,
  ) {
    this.log = new Logger(`${company.slug}:dispatch`, 'magenta');
    this.client = new RoutiqClient(baseUrl, this.log);
  }

  async connect(): Promise<void> {
    const auth = await this.client.login(this.company.dispatcher.email, this.password);
    this.log.ok('signed in', `role=${auth.tenant?.role ?? 'n/a'}`);
  }

  async findConfirmed(): Promise<Shipment[]> {
    const { data } = await this.client.get<{ data: Shipment[] }>('/shipments', {
      status: 'CONFIRMED',
    });
    this.log.info(`found ${data.length} confirmed shipment(s)`);
    return data;
  }

  async dispatchCandidates(shipmentId: string): Promise<DispatchCandidate[]> {
    const { data } = await this.client.get<{ data: DispatchCandidate[] }>(
      `/shipments/${shipmentId}/dispatch-candidates`,
    );
    return data;
  }

  /**
   * Offers the shipment to the best available candidate. Returns the offer so
   * the driver can accept it, or null when nobody is available.
   */
  async offer(shipment: Shipment): Promise<{ assignmentId: string; driverId: string } | null> {
    const candidates = await this.dispatchCandidates(shipment.id);
    if (candidates.length === 0) {
      this.log.warn(`no dispatch candidates for ${shipment.trackingNumber}`);
      return null;
    }

    const best = [...candidates].sort((a, b) => {
      if (a.withinRadius !== b.withinRadius) return a.withinRadius ? -1 : 1;
      return (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
        (b.distanceMeters ?? Number.POSITIVE_INFINITY);
    })[0]!;

    const assignment = await this.client.post<{ id: string; driverId: string }>(
      `/shipments/${shipment.id}/assignments`,
      { driverId: best.driverId, vehicleId: best.vehicleId ?? undefined, ttlMinutes: 30 },
    );
    this.log.ok(
      `offered ${shipment.trackingNumber}`,
      `driver=${best.driverId.slice(0, 8)} distance=${best.distanceMeters ?? '?'}m`,
    );
    return { assignmentId: assignment.id, driverId: assignment.driverId };
  }

  async planRoutes(): Promise<void> {
    const planDate = new Date().toISOString().slice(0, 10);
    const plan = await this.client.post<{ id: string; status: string; statusUrl: string }>(
      '/routes/plan',
      { planDate },
    );
    this.log.info('submitted route plan', `id=${plan.id.slice(0, 8)} status=${plan.status}`);
  }

  /**
   * Closes out a failed shipment as RETURNED. Only dispatchers and admins hold
   * `shipments:update`, so the driver's bot cannot do this itself.
   */
  async returnShipment(shipment: Shipment, reason: string): Promise<Shipment> {
    const returned = await this.client.post<Shipment>(
      `/shipments/${shipment.id}/return`,
      { reason },
      { ifMatch: shipment.version },
    );
    this.log.warn(`returned ${returned.trackingNumber}`, `${shipment.status} → ${returned.status}`);
    return returned;
  }
}
