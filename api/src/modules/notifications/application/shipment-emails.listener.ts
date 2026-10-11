import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventEnvelope } from '../../../shared/messaging/event-envelope.js';
import { CustomersService } from '../../customers/application/customers.service.js';
import type { EmailPriority } from './email-log.repository.js';
import { NotificationsService } from './notifications.service.js';

interface TemplateChoice {
  readonly template: string;
  readonly priority: EmailPriority;
}

/**
 * Turns shipment domain events into customer emails.
 *
 * The recipient is the shipment's customer profile (via the Customers
 * facade — never its repository), and the dedupe key follows the
 * architecture: event id + template + recipient. Customers without an email
 * address are skipped: nothing was ever deliverable.
 *
 * Template map (from the architecture's table):
 * `ShipmentConfirmed` → shipment-confirmed, assignment and out-for-delivery
 * come off `ShipmentStatusChanged`, `ShipmentDelivered` → delivered-receipt
 * (critical), `ShipmentFailed` → failed-attempt (critical). `ShipmentCreated`
 * deliberately sends nothing — audit consumes it.
 */
@Injectable()
export class ShipmentEmailsListener {
  private readonly logger = new Logger(ShipmentEmailsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly customers: CustomersService,
  ) {}

  @OnEvent('ShipmentConfirmed')
  onConfirmed(event: DomainEventEnvelope): Promise<void> {
    return this.toCustomer(event, {
      template: 'shipment-confirmed',
      priority: 'normal',
    });
  }

  @OnEvent('ShipmentDelivered')
  onDelivered(event: DomainEventEnvelope): Promise<void> {
    return this.toCustomer(event, {
      template: 'delivered-receipt',
      priority: 'critical',
    });
  }

  @OnEvent('ShipmentFailed')
  onFailed(event: DomainEventEnvelope): Promise<void> {
    return this.toCustomer(event, {
      template: 'failed-attempt',
      priority: 'critical',
    });
  }

  /** The two notification-worthy statuses riding on the generic event. */
  @OnEvent('ShipmentStatusChanged')
  onStatusChanged(event: DomainEventEnvelope): Promise<void> | void {
    const toStatus = event.payload['toStatus'];
    if (toStatus === 'ASSIGNED') {
      return this.toCustomer(event, {
        template: 'driver-assigned',
        priority: 'normal',
      });
    }
    if (toStatus === 'OUT_FOR_DELIVERY') {
      return this.toCustomer(event, {
        template: 'out-for-delivery',
        priority: 'normal',
      });
    }
    // Every other transition (pickup, transit, cancel, return) has no
    // template in the architecture's table; tracking and reporting consume
    // those instead.
    return undefined;
  }

  private async toCustomer(
    event: DomainEventEnvelope,
    choice: TemplateChoice,
  ): Promise<void> {
    const tenantId = event.tenantId;
    const customerId = event.payload['customerId'];
    const trackingNumber = event.payload['trackingNumber'];
    if (!tenantId || typeof customerId !== 'string') {
      this.logger.debug(
        { eventId: event.id, type: event.type },
        'event lacks tenant or customer; no email attempted',
      );
      return;
    }

    const customer = await this.customers.getCustomer(tenantId, customerId);
    if (!customer.email) {
      this.logger.debug(
        { customerId, template: choice.template },
        'customer has no email address; message skipped',
      );
      return;
    }

    await this.notifications.notify({
      tenantId,
      template: choice.template,
      recipient: customer.email,
      priority: choice.priority,
      dedupeKey: `${event.id}:${choice.template}:${customer.email}`,
      data: {
        customerName: customer.name,
        trackingNumber: typeof trackingNumber === 'string' ? trackingNumber : '',
        reason: event.payload['reason'] ?? null,
        failedAttempts: event.payload['failedAttempts'] ?? null,
      },
    });
  }
}
