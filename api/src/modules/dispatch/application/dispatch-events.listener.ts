import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventEnvelope } from '../../../shared/messaging/event-envelope.js';
import { DispatchService } from './dispatch.service.js';

/** Shipment statuses after which the driving assignment is over. */
const TERMINAL_SHIPMENT_STATUSES = new Set(['DELIVERED', 'RETURNED', 'CANCELLED']);

interface ShipmentStatusChangedPayload {
  readonly shipmentId?: unknown;
  readonly toStatus?: unknown;
}

/**
 * Releases the driver and the vehicle once a shipment reaches a terminal
 * status.
 *
 * Accepting an offer writes an `accepted` assignment, and the live partial
 * unique indexes treat that as holding both the driver and the vehicle; the
 * only other closers are an explicit cancel or an offer that expires. Without
 * this listener a delivered shipment keeps its driver booked forever and the
 * fleet drains after a single run.
 *
 * Delivery is in-process and inside the publisher's tenant transaction, so
 * the repository reads and writes share the RLS context. A failure must never
 * fail the shipment transition that triggered it, so it is logged and
 * swallowed.
 */
@Injectable()
export class DispatchEventListener {
  private readonly logger = new Logger(DispatchEventListener.name);

  constructor(private readonly dispatch: DispatchService) {}

  @OnEvent('ShipmentStatusChanged')
  async onShipmentStatusChanged(
    event: DomainEventEnvelope<ShipmentStatusChangedPayload>,
  ): Promise<void> {
    const toStatus = event.payload?.toStatus;
    const shipmentId = event.payload?.shipmentId;
    if (
      typeof toStatus !== 'string' ||
      !TERMINAL_SHIPMENT_STATUSES.has(toStatus) ||
      typeof shipmentId !== 'string' ||
      !event.tenantId
    ) {
      return;
    }
    try {
      await this.dispatch.completeTerminalShipment(event.tenantId, shipmentId);
    } catch (error) {
      this.logger.error(
        { err: error, shipmentId, toStatus },
        'failed to close the live assignment for a terminal shipment',
      );
    }
  }
}
