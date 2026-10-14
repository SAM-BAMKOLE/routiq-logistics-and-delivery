import type { SeededAddress, SeededCompany } from '../config.js';
import { RoutiqClient } from '../http.js';
import { Logger, sleep } from '../logger.js';
import type { Assignment, Shipment } from '../types.js';

/**
 * DriverAgent behaves like a driver's mobile app: it waits for an offer,
 * accepts it, drives the shipment through its status machine while streaming
 * GPS, captures proof of delivery, then completes the shipment.
 */
export class DriverAgent {
  readonly client: RoutiqClient;
  readonly log: Logger;
  driverId = '';

  constructor(
    company: SeededCompany,
    private readonly email: string,
    baseUrl: string,
    private readonly password: string,
    index: number,
  ) {
    this.log = new Logger(`${company.slug}:driver${index + 1}`, 'green');
    this.client = new RoutiqClient(baseUrl, this.log);
  }

  async connect(): Promise<void> {
    const auth = await this.client.login(this.email, this.password);
    // Going on shift returns the driver profile, which is how the bot learns
    // its own driver id (the offer carries driver ids, not e-mails).
    const driver = await this.client.patch<{ id: string }>('/drivers/me/availability', {
      availability: 'available',
    });
    this.driverId = driver.id;
    this.log.ok('on shift', `role=${auth.tenant?.role ?? 'n/a'} driver=${driver.id.slice(0, 8)}`);
  }

  /** Polls for an offered assignment targeting the given shipment. */
  async waitForOffer(shipmentId: string, timeoutMs = 30_000): Promise<Assignment | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { data } = await this.client.get<{ data: Assignment[] }>('/assignments/me');
      const offer = data.find((a) => a.shipmentId === shipmentId && a.status === 'offered');
      if (offer) return offer;
      await sleep(1_000);
    }
    return null;
  }

  async accept(assignmentId: string, shipmentId: string): Promise<Shipment> {
    const assignment = await this.client.post<Assignment>(
      `/assignments/${assignmentId}/accept`,
    );
    this.log.ok('accepted offer', `assignment=${assignment.status}`);
    const shipment = await this.client.get<Shipment>(`/shipments/${shipmentId}`);
    this.log.info(`shipment ready`, `status=${shipment.status}`);
    return shipment;
  }

  /** Streams a GPS trace interpolated between two addresses. */
  async pushTrace(from: SeededAddress, to: SeededAddress): Promise<void> {
    const now = Date.now();
    const samples = 6;
    const points = Array.from({ length: samples }, (_, index) => {
      const t = (index + 1) / samples;
      const jitter = () => (Math.random() - 0.5) * 0.002;
      return {
        latitude: Number((from.lat + (to.lat - from.lat) * t + jitter()).toFixed(6)),
        longitude: Number((from.lng + (to.lng - from.lng) * t + jitter()).toFixed(6)),
        recordedAt: new Date(now - (samples - index) * 20_000).toISOString(),
        speedKmh: 28 + Math.round(Math.random() * 18),
      };
    });

    const result = await this.client.post<{ accepted: number; discarded: unknown[] }>(
      '/tracking/locations',
      { points },
    );
    this.log.info(
      `streamed location`,
      `accepted=${result.accepted}/${points.length} discarded=${result.discarded.length}`,
    );
  }

  private async transition(shipment: Shipment, action: string): Promise<Shipment> {
    const next = await this.client.post<Shipment>(
      `/shipments/${shipment.id}/${action}`,
      undefined,
      { ifMatch: shipment.version },
    );
    this.log.ok(action, `${shipment.status} → ${next.status}`);
    return next;
  }

  /** Drives one assigned shipment all the way to DELIVERED. */
  async completeDelivery(
    assigned: Shipment,
    from: SeededAddress,
    to: SeededAddress,
  ): Promise<Shipment> {
    let shipment = await this.transition(assigned, 'pickup');
    shipment = await this.transition(shipment, 'start-transit');
    await this.pushTrace(from, to);
    shipment = await this.transition(shipment, 'start-delivery');
    await this.captureProof(shipment.id, 'Front desk');
    const delivered = await this.transition(shipment, 'deliver');
    this.log.ok(`delivered ${delivered.trackingNumber}`);
    return delivered;
  }

  async captureProof(shipmentId: string, recipientName = 'Front desk'): Promise<void> {
    await this.client.post(`/shipments/${shipmentId}/proof`, {
      type: 'photo',
      fileUrl: `https://cdn.routiq.demo/proofs/${shipmentId}.jpg`,
      recipientName,
    });
    this.log.ok('captured proof of delivery', `recipient=${recipientName}`);
  }
}
