import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventEnvelope } from '../../../shared/messaging/event-envelope.js';
import { TenantsService } from '../../tenants/application/tenants.service.js';
import { shipmentPolicyFrom } from '../../shipments/domain/shipment-policy.js';
import { ProofsService } from './proofs.service.js';

/**
 * Issues the delivery OTP when a shipment goes out for delivery.
 *
 * Only when the tenant demands proof: tenants that accept a bare delivery
 * confirmations do not need a code emailed to their customer. The listener
 * runs in the publisher's context (in-process bus), so the OTP row lands in
 * the same transaction as the status change that triggered it.
 *
 * A failure here is swallowed and logged by the event bus — the shipment is
 * already out for delivery, and the driver can still capture a signature;
 * the code is a convenience, not a gate.
 */
@Injectable()
export class OtpEmailsListener {
  private readonly logger = new Logger(OtpEmailsListener.name);

  constructor(
    private readonly proofs: ProofsService,
    private readonly tenants: TenantsService,
  ) {}

  @OnEvent('ShipmentStatusChanged')
  async onStatusChanged(event: DomainEventEnvelope): Promise<void> {
    if (event.payload['toStatus'] !== 'OUT_FOR_DELIVERY') {
      return;
    }
    const tenantId = event.tenantId;
    const shipmentId = event.payload['shipmentId'];
    if (!tenantId || typeof shipmentId !== 'string') {
      return;
    }
    try {
      const settings = (await this.tenants.getById(tenantId)).settings;
      if (!shipmentPolicyFrom(settings).requireProofOfDelivery) {
        return; // No proof demanded, no code needed.
      }
      await this.proofs.issueOtp(tenantId, shipmentId, 'issued');
    } catch (error) {
      this.logger.error(
        { err: error, eventId: event.id, shipmentId },
        'delivery OTP could not be issued',
      );
    }
  }
}
