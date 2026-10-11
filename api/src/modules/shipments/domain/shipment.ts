import { canTransition, type ShipmentStatus } from './shipment-status.js';

/**
 * Domain error raised by the shipment aggregate. Framework-free on purpose:
 * the application layer maps codes to HTTP problem+json responses
 * (`SHIPMENT_INVALID_TRANSITION` and `SHIPMENT_RETRY_EXHAUSTED` become 409s,
 * `SHIPMENT_REASON_REQUIRED` a 422).
 */
export class ShipmentDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ShipmentDomainError';
  }
}

/** A line item of a shipment (immutable after creation). */
export interface ShipmentItem {
  readonly description: string;
  readonly quantity: number;
  readonly weightKg: number | null;
}

/** One appended row of the shipment's status history. */
export interface ShipmentTransition {
  readonly fromStatus: ShipmentStatus | null;
  readonly toStatus: ShipmentStatus;
  readonly reason: string | null;
  readonly occurredAt: Date;
}

export type ShipmentEventType =
  | 'ShipmentCreated'
  | 'ShipmentConfirmed'
  | 'ShipmentStatusChanged'
  | 'ShipmentDelivered'
  | 'ShipmentFailed';

/** A domain event raised by the aggregate (consumers arrive in Step 7). */
export interface ShipmentDomainEvent {
  readonly type: ShipmentEventType;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
}

export interface CreateShipmentProps {
  readonly id: string;
  readonly tenantId: string;
  readonly trackingNumber: string;
  readonly customerId: string;
  readonly pickupAddressId: string;
  readonly dropoffAddressId: string;
  readonly weightKg: number;
  readonly volumeM3: number | null;
  readonly windowStart: Date | null;
  readonly windowEnd: Date | null;
  readonly priceMinor: number | null;
  readonly currency: string;
  readonly items?: readonly ShipmentItem[];
}

export interface RehydrateShipmentProps extends CreateShipmentProps {
  readonly status: ShipmentStatus;
  readonly failedAttempts: number;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly items: readonly ShipmentItem[];
}

/**
 * The Shipment aggregate: the only place in the codebase allowed to change a
 * shipment's status. Every transition checks the state machine table, appends
 * a history entry, bumps the optimistic-lock version, and raises domain
 * events - all in memory, so the whole life of a shipment is testable
 * without I/O. Persistence (history rows written in the same transaction)
 * belongs to the application layer.
 */
export class Shipment {
  private currentStatus: ShipmentStatus;
  private currentVersion: number;
  private attempts: number;
  private readonly eventQueue: ShipmentDomainEvent[] = [];
  private readonly transitionQueue: ShipmentTransition[] = [];

  private constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly trackingNumber: string,
    readonly customerId: string,
    readonly pickupAddressId: string,
    readonly dropoffAddressId: string,
    readonly weightKg: number,
    readonly volumeM3: number | null,
    readonly windowStart: Date | null,
    readonly windowEnd: Date | null,
    readonly priceMinor: number | null,
    readonly currency: string,
    readonly items: readonly ShipmentItem[],
    props: {
      status: ShipmentStatus;
      failedAttempts: number;
      version: number;
      createdAt: Date;
      updatedAt: Date;
    },
  ) {
    this.currentStatus = props.status;
    this.attempts = props.failedAttempts;
    this.currentVersion = props.version;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  readonly createdAt: Date;
  updatedAt: Date;

  get status(): ShipmentStatus {
    return this.currentStatus;
  }

  get version(): number {
    return this.currentVersion;
  }

  get failedAttempts(): number {
    return this.attempts;
  }

  /** Events raised since the last {@link pullDomainEvents}. */
  pullDomainEvents(): ShipmentDomainEvent[] {
    return this.eventQueue.splice(0, this.eventQueue.length);
  }

  /** History rows to append since the last {@link pullTransitions}. */
  pullTransitions(): ShipmentTransition[] {
    return this.transitionQueue.splice(0, this.transitionQueue.length);
  }

  static create(input: CreateShipmentProps): Shipment {
    const now = new Date();
    const shipment = new Shipment(
      input.id,
      input.tenantId,
      input.trackingNumber,
      input.customerId,
      input.pickupAddressId,
      input.dropoffAddressId,
      input.weightKg,
      input.volumeM3,
      input.windowStart,
      input.windowEnd,
      input.priceMinor,
      input.currency,
      input.items ?? [],
      {
        status: 'CREATED',
        failedAttempts: 0,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    );
    shipment.transitionQueue.push({
      fromStatus: null,
      toStatus: 'CREATED',
      reason: null,
      occurredAt: now,
    });
    shipment.eventQueue.push({
      type: 'ShipmentCreated',
      occurredAt: now,
      payload: {
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        customerId: shipment.customerId,
      },
    });
    return shipment;
  }

  static rehydrate(props: RehydrateShipmentProps): Shipment {
    return new Shipment(
      props.id,
      props.tenantId,
      props.trackingNumber,
      props.customerId,
      props.pickupAddressId,
      props.dropoffAddressId,
      props.weightKg,
      props.volumeM3,
      props.windowStart,
      props.windowEnd,
      props.priceMinor,
      props.currency,
      props.items,
      {
        status: props.status,
        failedAttempts: props.failedAttempts,
        version: props.version,
        createdAt: props.createdAt,
        updatedAt: props.updatedAt,
      },
    );
  }

  /** CREATED to CONFIRMED. Requires the quote stored at creation. */
  confirm(): void {
    if (this.priceMinor === null) {
      throw new ShipmentDomainError(
        'SHIPMENT_QUOTE_REQUIRED',
        'A shipment needs a valid quote before it can be confirmed.',
      );
    }
    this.transition('CONFIRMED', { extraEvents: ['ShipmentConfirmed'] });
  }

  /** Cancel - allowed only before pickup, per the business rules. */
  cancel(reason: string | null = null): void {
    if (!canTransition(this.currentStatus, 'CANCELLED')) {
      throw new ShipmentDomainError(
        'SHIPMENT_INVALID_TRANSITION',
        `A shipment in status ${this.currentStatus} cannot be cancelled.`,
      );
    }
    this.transition('CANCELLED', { reason });
  }

  /** CONFIRMED to ASSIGNED. Dispatch owns who the driver is; the aggregate
   * only carries the identity into its events and history. */
  assign(driverId: string, vehicleId: string | null = null): void {
    if (!driverId) {
      throw new ShipmentDomainError(
        'SHIPMENT_DRIVER_REQUIRED',
        'An assignment needs a driver.',
      );
    }
    this.transition('ASSIGNED', { payload: { driverId, vehicleId } });
  }

  /** ASSIGNED back to CONFIRMED (assignment withdrawn or rejected). */
  release(reason: string | null = null): void {
    this.transition('CONFIRMED', { reason });
  }

  markPickedUp(): void {
    this.transition('PICKED_UP');
  }

  startTransit(): void {
    this.transition('IN_TRANSIT');
  }

  startDelivery(): void {
    this.transition('OUT_FOR_DELIVERY');
  }

  /** OUT_FOR_DELIVERY to DELIVERED. Proof requirements are an application
   * policy (tenant setting) checked before this is called. */
  deliver(): void {
    this.transition('DELIVERED', { extraEvents: ['ShipmentDelivered'] });
  }

  /** OUT_FOR_DELIVERY to FAILED_ATTEMPT. A reason code is mandatory. */
  fail(reason: string): void {
    if (!reason || reason.trim().length === 0) {
      throw new ShipmentDomainError(
        'SHIPMENT_REASON_REQUIRED',
        'A failed delivery attempt requires a reason code.',
      );
    }
    this.attempts += 1;
    this.transition('FAILED_ATTEMPT', {
      reason,
      extraEvents: ['ShipmentFailed'],
      // Consumers (the failed-attempt email, dispatch) need the reason and
      // the running count, not just the status change.
      payload: { reason, failedAttempts: this.attempts },
    });
  }

  /** FAILED_ATTEMPT back to OUT_FOR_DELIVERY - until the attempts are used up. */
  retry(maxFailedAttempts: number): void {
    if (this.attempts >= maxFailedAttempts) {
      throw new ShipmentDomainError(
        'SHIPMENT_RETRY_EXHAUSTED',
        `After ${this.attempts} failed attempts the only way forward is a return.`,
      );
    }
    this.transition('OUT_FOR_DELIVERY');
  }

  /** FAILED_ATTEMPT to RETURNED: the shipment goes back to the sender. */
  returnShipment(reason: string | null = null): void {
    this.transition('RETURNED', { reason });
  }

  private transition(
    to: ShipmentStatus,
    options: {
      reason?: string | null;
      extraEvents?: readonly ShipmentEventType[];
      payload?: Record<string, unknown>;
    } = {},
  ): void {
    if (!canTransition(this.currentStatus, to)) {
      throw new ShipmentDomainError(
        'SHIPMENT_INVALID_TRANSITION',
        `A shipment in status ${this.currentStatus} cannot move to ${to}.`,
      );
    }
    const occurredAt = new Date();
    const from = this.currentStatus;
    this.transitionQueue.push({
      fromStatus: from,
      toStatus: to,
      reason: options.reason ?? null,
      occurredAt,
    });
    this.currentStatus = to;
    this.currentVersion += 1;
    this.updatedAt = occurredAt;

    const payload = {
      shipmentId: this.id,
      trackingNumber: this.trackingNumber,
      customerId: this.customerId,
      fromStatus: from,
      toStatus: to,
      ...options.payload,
    };
    this.eventQueue.push({
      type: 'ShipmentStatusChanged',
      occurredAt,
      payload,
    });
    for (const type of options.extraEvents ?? []) {
      this.eventQueue.push({ type, occurredAt, payload });
    }
  }
}
