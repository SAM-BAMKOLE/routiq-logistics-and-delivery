import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Role } from '../../identity/domain/membership.js';
import { CustomersService } from '../../customers/application/customers.service.js';
import { NotificationsService } from '../../notifications/application/notifications.service.js';
import { ShipmentsService } from '../../shipments/application/shipments.service.js';
import { EVENT_BUS, type EventBus } from '../../../shared/messaging/event-bus.js';
import { createEnvelope } from '../../../shared/messaging/event-envelope.js';
import {
  deriveOtpPepper,
  generateDeliveryOtp,
  hashDeliveryOtp,
  verifyDeliveryOtp,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_HOURS,
} from '../domain/delivery-otp.js';
import {
  assertCapturable,
  ProofDomainError,
  type CaptureProofInput,
} from '../domain/proof.js';
import {
  PROOF_REPOSITORY,
  type CapturedProof,
  type ProofRepository,
} from '../domain/proof.repository.js';

/** Who is acting: the authenticated principal's identity and tenant role. */
export interface ProofActor {
  readonly userId: string;
  readonly role: Role;
}

/**
 * Application service for proof of delivery: the evidence a parcel reached a
 * human, and the OTP flow that proves it without a signature.
 *
 * Scoping is borrowed from the shipments facade — `ShipmentsService.get`
 * answers 404 for anything this actor may not see — and only an
 * OUT_FOR_DELIVERY shipment accepts a proof, the same rule the aggregate
 * enforces on the other side of the `deliver()` gate.
 *
 * The OTP is issued when a shipment goes out for delivery (see
 * {@link OtpEmailsListener}), stored only as a hash, and retired on success,
 * expiry, or lockout. `ProofCaptured` is the module's single outbound event.
 */
@Injectable()
export class ProofsService {
  private readonly logger = new Logger(ProofsService.name);
  private readonly pepper: string;

  constructor(
    @Inject(PROOF_REPOSITORY) private readonly proofs: ProofRepository,
    private readonly shipments: ShipmentsService,
    private readonly customers: CustomersService,
    private readonly notifications: NotificationsService,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    config: ConfigService,
  ) {
    this.pepper = deriveOtpPepper(
      config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    );
  }

  /**
   * Captures a photo or signature against an out-for-delivery shipment.
   * Drivers capture on their own assignments; dispatchers on any.
   */
  async capture(
    actor: ProofActor,
    tenantId: string,
    shipmentId: string,
    input: CaptureProofInput,
  ): Promise<CapturedProof> {
    await this.loadInFlight(actor, tenantId, shipmentId);
    try {
      assertCapturable(input);
    } catch (error) {
      throw mapProofDomainError(error);
    }
    const proof = await this.proofs.insertProof({
      shipmentId,
      type: input.type,
      fileUrl: input.fileUrl ?? null,
      recipientName: input.recipientName ?? null,
    });
    await this.publishCaptured(tenantId, proof);
    this.logger.debug(
      { proofId: proof.id, shipmentId, type: proof.type },
      'proof of delivery captured',
    );
    return proof;
  }

  /**
   * Verifies the recipient's code and records the OTP proof. Five wrong
   * guesses (or an expired code) retire the code; the driver reissues one
   * through the reissue endpoint.
   */
  async verifyOtp(
    actor: ProofActor,
    tenantId: string,
    shipmentId: string,
    code: string,
  ): Promise<CapturedProof> {
    await this.loadInFlight(actor, tenantId, shipmentId);
    const pending = await this.proofs.findPendingOtp(shipmentId);
    if (!pending) {
      throw lockedOrMissing('OTP_NOT_OUTSTANDING', 'No delivery code is outstanding for this shipment.');
    }
    if (pending.expiresAt.getTime() <= Date.now()) {
      await this.proofs.clearOtp(shipmentId);
      throw lockedOrMissing('OTP_EXPIRED', 'The delivery code has expired; ask for a new one.');
    }
    if (pending.attempts >= OTP_MAX_ATTEMPTS) {
      await this.proofs.clearOtp(shipmentId);
      throw lockedOrMissing('OTP_LOCKED', 'Too many wrong codes; this one is retired.');
    }
    if (!verifyDeliveryOtp(this.pepper, shipmentId, code, pending.hash)) {
      const attempts = pending.attempts + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await this.proofs.clearOtp(shipmentId);
        throw lockedOrMissing('OTP_LOCKED', 'Too many wrong codes; this one is retired.');
      }
      await this.proofs.recordOtpAttempt(shipmentId, attempts);
      throw lockedOrMissing('OTP_INVALID', 'That code is not right.');
    }

    await this.proofs.clearOtp(shipmentId);
    const proof = await this.proofs.insertProof({
      shipmentId,
      type: 'otp',
      fileUrl: null,
      recipientName: null,
    });
    await this.publishCaptured(tenantId, proof);
    this.logger.debug({ proofId: proof.id, shipmentId }, 'delivery OTP verified');
    return proof;
  }

  /**
   * Issues (or reissues) the delivery OTP for a shipment. Called by the
   * status listener when a shipment goes out for delivery, and by the
   * reissue endpoint when the first code is lost.
   *
   * The plaintext goes straight into the customer email and is dropped: the
   * row keeps only the hash.
   */
  async issueOtp(
    tenantId: string,
    shipmentId: string,
    reason: 'issued' | 'reissued',
  ): Promise<void> {
    const shipment = await this.shipments.get(
      // Tenant-admin stand-in: the listener acts on the tenant's behalf, and
      // the facade's job here is existence + status, not actor scoping.
      { userId: '', role: 'tenant_admin' },
      tenantId,
      shipmentId,
    );
    if (shipment.status !== 'OUT_FOR_DELIVERY') {
      return; // Late listener run, or a reissue after delivery settled.
    }
    const code = generateDeliveryOtp();
    await this.proofs.saveOtp(shipmentId, {
      hash: hashDeliveryOtp(this.pepper, shipmentId, code),
      expiresAt: new Date(Date.now() + OTP_TTL_HOURS * 3_600_000),
      attempts: 0,
    });
    await this.emailCode(tenantId, shipment, code, reason);
  }

  /**
   * Every proof of a shipment, oldest first (the track view shows these).
   * Ownership is checked first: the facade answers 404 for a shipment this
   * actor may not see, so a guessed UUID leaks nothing.
   */
  async listForShipment(
    actor: ProofActor,
    tenantId: string,
    shipmentId: string,
  ): Promise<CapturedProof[]> {
    await this.shipments.get(actor, tenantId, shipmentId);
    return this.proofs.listProofs(shipmentId);
  }

  /** OUT_FOR_DELIVERY or a 409: the state machine decides, not this module. */
  private async loadInFlight(
    actor: ProofActor,
    tenantId: string,
    shipmentId: string,
  ): Promise<{ id: string; status: string }> {
    const shipment = await this.shipments.get(actor, tenantId, shipmentId);
    if (shipment.status !== 'OUT_FOR_DELIVERY') {
      throw new ConflictException({
        message: `A shipment in status ${shipment.status} cannot receive proof of delivery.`,
        code: 'PROOF_WRONG_STATUS',
      });
    }
    return shipment;
  }

  /** The one outbound event; audit consumes it, phase 3 stores it. */
  private async publishCaptured(
    tenantId: string,
    proof: CapturedProof,
  ): Promise<void> {
    await this.events.publish(
      createEnvelope({
        type: 'ProofCaptured',
        tenantId,
        aggregateType: 'shipment',
        aggregateId: proof.shipmentId,
        payload: {
          proofId: proof.id,
          shipmentId: proof.shipmentId,
          type: proof.type,
          recipientName: proof.recipientName,
          capturedAt: proof.capturedAt.toISOString(),
        },
      }),
    );
  }

  /**
   * Sends the plaintext code to the customer. The email is the only place
   * the digits exist in the clear — phase 2's outbox must render from this
   * call, never from a stored event payload.
   */
  private async emailCode(
    tenantId: string,
    shipment: { id: string; trackingNumber: string; customerId: string },
    code: string,
    reason: 'issued' | 'reissued',
  ): Promise<void> {
    const customer = await this.customers.getCustomer(
      tenantId,
      shipment.customerId,
    );
    if (!customer.email) {
      this.logger.warn(
        { shipmentId: shipment.id, customerId: customer.id },
        'delivery code generated but the customer has no email; ' +
          'the driver must fall back to a signature',
      );
      return;
    }
    await this.notifications.notify({
      tenantId,
      template: 'delivery-otp',
      recipient: customer.email,
      priority: 'normal',
      // Reissues carry a fresh key so the second email is not suppressed.
      dedupeKey:
        reason === 'issued'
          ? `otp:${shipment.id}:${customer.email}`
          : `otp:${shipment.id}:${customer.email}:${randomUUID()}`,
      data: {
        customerName: customer.name,
        trackingNumber: shipment.trackingNumber,
        code,
        ttlHours: OTP_TTL_HOURS,
      },
    });
  }
}

function lockedOrMissing(code: string, message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ message, code });
}

function mapProofDomainError(error: unknown): unknown {
  if (error instanceof ProofDomainError) {
    return new UnprocessableEntityException({
      message: error.message,
      code: error.code,
    });
  }
  return error;
}
