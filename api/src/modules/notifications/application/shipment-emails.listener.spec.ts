import { jest } from '@jest/globals';
import type { CustomersService } from '../../customers/application/customers.service.js';
import type { Customer } from '../../customers/domain/customer.js';
import type { NotifyInput, NotificationsService } from './notifications.service.js';
import { ShipmentEmailsListener } from './shipment-emails.listener.js';
import { createEnvelope } from '../../../shared/messaging/event-envelope.js';

function customerFixture(id: string, email: string | null): Customer {
  return {
    id,
    tenantId: 't-1',
    name: 'Ada',
    email,
    phone: null,
    userId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeHarness(customer: Customer = customerFixture('c-1', 'ada@example.com')) {
  const notify = jest
    .fn<(...args: [NotifyInput]) => Promise<string>>()
    .mockResolvedValue('sent');
  const notifications = { notify } as unknown as NotificationsService;
  const customers = {
    getCustomer: async (_tenantId: string, id: string) => {
      if (id !== customer.id) {
        throw new Error(`customer ${id} not found`);
      }
      return customer;
    },
  } as unknown as CustomersService;
  const listener = new ShipmentEmailsListener(notifications, customers);
  return { listener, notify };
}

function shipmentEvent(
  type: string,
  payload: Record<string, unknown>,
  tenantId: string | null = 't-1',
) {
  return createEnvelope({
    type,
    tenantId,
    aggregateType: 'shipment',
    aggregateId: 's-1',
    aggregateVersion: 2,
    payload: {
      customerId: 'c-1',
      trackingNumber: 'SHP-QQQ111222333',
      ...payload,
    },
  });
}

/**
 * The architecture's consumer table, one assertion per row: which shipment
 * event mails which template, at which priority.
 */
describe('ShipmentEmailsListener', () => {
  it.each([
    ['ShipmentConfirmed', 'onConfirmed', {}, 'shipment-confirmed', 'normal'],
    ['ShipmentStatusChanged', 'onStatusChanged', { fromStatus: 'CONFIRMED', toStatus: 'ASSIGNED' }, 'driver-assigned', 'normal'],
    ['ShipmentStatusChanged', 'onStatusChanged', { fromStatus: 'ASSIGNED', toStatus: 'OUT_FOR_DELIVERY' }, 'out-for-delivery', 'normal'],
    ['ShipmentDelivered', 'onDelivered', { fromStatus: 'OUT_FOR_DELIVERY', toStatus: 'DELIVERED' }, 'delivered-receipt', 'critical'],
    ['ShipmentFailed', 'onFailed', { fromStatus: 'OUT_FOR_DELIVERY', toStatus: 'FAILED_ATTEMPT' }, 'failed-attempt', 'critical'],
  ] as const)(
    'maps %s to %s',
    async (type, method, payload, template, priority) => {
      const { listener, notify } = makeHarness();
      const handler = listener[method] as (
        event: ReturnType<typeof shipmentEvent>,
      ) => Promise<void>;

      await handler.call(listener, shipmentEvent(type, payload));

      expect(notify).toHaveBeenCalledTimes(1);
      const input = notify.mock.calls[0][0];
      expect(input).toMatchObject({
        tenantId: 't-1',
        template,
        priority,
        recipient: 'ada@example.com',
      });
      expect(input.dedupeKey).toEqual(
        expect.stringContaining(`:${template}:ada@example.com`),
      );
      expect(input.data).toMatchObject({ trackingNumber: 'SHP-QQQ111222333' });
    },
  );

  it('stays silent for transitions with no template', async () => {
    const { listener, notify } = makeHarness();

    await listener.onStatusChanged(
      shipmentEvent('ShipmentStatusChanged', {
        fromStatus: 'PICKED_UP',
        toStatus: 'IN_TRANSIT',
      }),
    );

    expect(notify).not.toHaveBeenCalled();
  });

  it('passes the failure reason and attempt count through', async () => {
    const { listener, notify } = makeHarness();

    await listener.onFailed(
      shipmentEvent('ShipmentFailed', {
        fromStatus: 'OUT_FOR_DELIVERY',
        toStatus: 'FAILED_ATTEMPT',
        reason: 'nobody home',
        failedAttempts: 2,
      }),
    );

    expect(notify.mock.calls[0][0].data).toMatchObject({
      reason: 'nobody home',
      failedAttempts: 2,
    });
  });

  it('skips customers without an email address', async () => {
    const { listener, notify } = makeHarness(
      customerFixture('c-1', null),
    );

    await listener.onConfirmed(shipmentEvent('ShipmentConfirmed', {}));

    expect(notify).not.toHaveBeenCalled();
  });

  it('never mails across tenants: a tenantless event is ignored', async () => {
    const { listener, notify } = makeHarness();

    await listener.onConfirmed(
      shipmentEvent('ShipmentConfirmed', {}, null),
    );

    expect(notify).not.toHaveBeenCalled();
  });
});
