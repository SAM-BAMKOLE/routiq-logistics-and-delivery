/**
 * The assignment lifecycle in domain terms: an offer to a driver and how it
 * ended. Framework-free on purpose — transitions are pure and every rule
 * lives here, so the whole negotiation is testable without I/O.
 *
 * The lifecycle (architecture, "Dispatch and driver assignment"):
 *
 *     offered ──accept──▶ accepted ──complete──▶ completed (shipment done)
 *        │                  │
 *        ├─reject──▶ rejected          expired: the offer outlived its TTL
 *        ├─expire──▶ expired           (lazily realised; the phase-2 queue
 *        └─cancel──▶ cancelled          replaces the sweep with a job)
 *
 * `offered` and `accepted` are the *live* statuses: they hold both the
 * shipment and the driver, and the database enforces "one live assignment
 * per shipment and per driver" with partial unique indexes, so two
 * concurrent dispatch runs cannot double-book either side. `completed` is
 * terminal and frees both sides once the shipment is delivered.
 */
export const ASSIGNMENT_STATUSES = [
  'offered',
  'accepted',
  'completed',
  'rejected',
  'expired',
  'cancelled',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** Statuses that hold the shipment and the driver. */
export const LIVE_ASSIGNMENT_STATUSES = ['offered', 'accepted'] as const;

export function isAssignmentStatus(value: unknown): value is AssignmentStatus {
  return (
    typeof value === 'string' && (ASSIGNMENT_STATUSES as readonly string[]).includes(value)
  );
}

export function isLiveAssignmentStatus(
  value: AssignmentStatus,
): value is (typeof LIVE_ASSIGNMENT_STATUSES)[number] {
  return (LIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Domain error raised by the assignment aggregate. Framework-free on purpose:
 * the application layer maps codes to HTTP problem+json responses (the
 * 409-generating codes become conflicts).
 */
export class AssignmentDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AssignmentDomainError';
  }
}

export type AssignmentEventType =
  | 'AssignmentOffered'
  | 'DriverAssigned'
  | 'AssignmentCompleted'
  | 'AssignmentRejected'
  | 'AssignmentExpired'
  | 'AssignmentCancelled';

/** A domain event raised by the aggregate. */
export interface AssignmentDomainEvent {
  readonly type: AssignmentEventType;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
}

export interface OfferAssignmentProps {
  readonly id: string;
  readonly tenantId: string;
  readonly shipmentId: string;
  readonly driverId: string;
  readonly vehicleId: string | null;
  readonly expiresAt: Date;
}

export interface RehydrateAssignmentProps extends OfferAssignmentProps {
  readonly status: AssignmentStatus;
  readonly offeredAt: Date;
  readonly respondedAt: Date | null;
  readonly reason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The Assignment aggregate: the only place allowed to change an assignment's
 * status. Every transition guards the lifecycle table above, stamps
 * `responded_at`, and raises a domain event — all in memory. Persistence
 * (and the shipment transition that acceptance triggers) belongs to the
 * application layer.
 */
export class Assignment {
  private currentStatus: AssignmentStatus;
  private readonly eventQueue: AssignmentDomainEvent[] = [];

  private constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly shipmentId: string,
    readonly driverId: string,
    readonly vehicleId: string | null,
    readonly offeredAt: Date,
    readonly expiresAt: Date,
    private currentRespondedAt: Date | null,
    private currentReason: string | null,
    readonly createdAt: Date,
    private currentUpdatedAt: Date,
    status: AssignmentStatus,
  ) {
    this.currentStatus = status;
  }

  static offer(props: OfferAssignmentProps): Assignment {
    const now = new Date();
    const assignment = new Assignment(
      props.id,
      props.tenantId,
      props.shipmentId,
      props.driverId,
      props.vehicleId,
      now,
      props.expiresAt,
      null,
      null,
      now,
      now,
      'offered',
    );
    // The offer is itself an event: the application layer publishes it right
    // after the insert, and the WebSocket gateway pushes it to the driver's
    // room as `offer:new`.
    assignment.eventQueue.push({
      type: 'AssignmentOffered',
      occurredAt: now,
      payload: {
        ...assignment.basePayload(),
        expiresAt: props.expiresAt.toISOString(),
      },
    });
    return assignment;
  }

  static rehydrate(props: RehydrateAssignmentProps): Assignment {
    return new Assignment(
      props.id,
      props.tenantId,
      props.shipmentId,
      props.driverId,
      props.vehicleId,
      props.offeredAt,
      props.expiresAt,
      props.respondedAt,
      props.reason,
      props.createdAt,
      props.updatedAt,
      props.status,
    );
  }

  get status(): AssignmentStatus {
    return this.currentStatus;
  }

  get respondedAt(): Date | null {
    return this.currentRespondedAt;
  }

  get reason(): string | null {
    return this.currentReason;
  }

  get updatedAt(): Date {
    return this.currentUpdatedAt;
  }

  /** Whether the assignment still holds the shipment and the driver. */
  get isLive(): boolean {
    return isLiveAssignmentStatus(this.currentStatus);
  }

  /** True when an offer has outlived its TTL and is due to expire lazily. */
  isOverdue(now: Date): boolean {
    return (
      this.currentStatus === 'offered' && this.expiresAt.getTime() <= now.getTime()
    );
  }

  /** Events raised since the last {@link pullDomainEvents}. */
  pullDomainEvents(): AssignmentDomainEvent[] {
    return this.eventQueue.splice(0, this.eventQueue.length);
  }

  /** offered to accepted: the driver took the job. */
  accept(): void {
    this.ensureOffered('accept');
    const now = new Date();
    this.currentStatus = 'accepted';
    this.currentRespondedAt = now;
    this.currentUpdatedAt = now;
    this.eventQueue.push({
      type: 'DriverAssigned',
      occurredAt: now,
      payload: this.basePayload(),
    });
  }

  /**
   * accepted to completed: the shipment reached a terminal state (delivered,
   * returned, cancelled). Terminal, so the partial unique indexes release the
   * driver and the vehicle. Unlike {@link cancel} it does not touch the
   * shipment — the caller already moved it.
   */
  complete(): void {
    this.ensureAccepted('complete');
    const now = new Date();
    this.currentStatus = 'completed';
    this.currentRespondedAt = now;
    this.currentUpdatedAt = now;
    this.eventQueue.push({
      type: 'AssignmentCompleted',
      occurredAt: now,
      payload: this.basePayload(),
    });
  }

  /** offered to rejected: the driver passed; the shipment stays CONFIRMED. */
  reject(reason: string | null = null): void {
    this.ensureOffered('reject');
    const now = new Date();
    this.currentStatus = 'rejected';
    this.currentRespondedAt = now;
    this.currentReason = reason;
    this.currentUpdatedAt = now;
    this.eventQueue.push({
      type: 'AssignmentRejected',
      occurredAt: now,
      payload: { ...this.basePayload(), reason },
    });
  }

  /** offered to expired: the offer outlived its TTL. */
  expire(): void {
    this.ensureOffered('expire');
    const now = new Date();
    this.currentStatus = 'expired';
    this.currentRespondedAt = now;
    this.currentUpdatedAt = now;
    this.eventQueue.push({
      type: 'AssignmentExpired',
      occurredAt: now,
      payload: this.basePayload(),
    });
  }

  /** offered or accepted to cancelled: someone withdrew. The application
   * layer releases the shipment back to CONFIRMED when it was accepted. */
  cancel(reason: string | null = null): void {
    if (!this.isLive) {
      throw new AssignmentDomainError(
        'ASSIGNMENT_NOT_LIVE',
        `An assignment in status ${this.currentStatus} cannot be cancelled.`,
      );
    }
    const now = new Date();
    this.currentStatus = 'cancelled';
    this.currentRespondedAt = now;
    this.currentReason = reason;
    this.currentUpdatedAt = now;
    this.eventQueue.push({
      type: 'AssignmentCancelled',
      occurredAt: now,
      payload: { ...this.basePayload(), reason },
    });
  }

  private ensureOffered(action: string): void {
    if (this.currentStatus !== 'offered') {
      throw new AssignmentDomainError(
        'ASSIGNMENT_NOT_OFFERED',
        `An assignment in status ${this.currentStatus} cannot be ${action}ed.`,
      );
    }
  }

  private ensureAccepted(action: string): void {
    if (this.currentStatus !== 'accepted') {
      throw new AssignmentDomainError(
        'ASSIGNMENT_NOT_ACCEPTED',
        `An assignment in status ${this.currentStatus} cannot be ${action}ed.`,
      );
    }
  }

  private basePayload(): Record<string, unknown> {
    return {
      assignmentId: this.id,
      shipmentId: this.shipmentId,
      driverId: this.driverId,
      vehicleId: this.vehicleId,
    };
  }
}
