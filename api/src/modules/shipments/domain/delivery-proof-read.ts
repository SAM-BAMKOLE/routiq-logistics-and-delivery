/**
 * Outbound port for reading captured proof of delivery from the shipments
 * side.
 *
 * The proof rows belong to the proof-of-delivery module, but `deliver()` must
 * gate on them. Reading the table directly (instead of importing the module)
 * keeps the dependency one-way — proof-of-delivery imports shipments for
 * actor scoping, so the reverse import would be a cycle. Same pattern as
 * dispatch reading `driver_locations`: a documented cross-module read, with
 * RLS still enforcing tenant scope.
 */
/** DI token for the {@link DeliveryProofRead} port. */
export const DELIVERY_PROOF_READ = Symbol('DELIVERY_PROOF_READ');

export interface DeliveryProofRead {
  /**
   * Whether at least one proof row exists for the shipment (photo, signature,
   * or verified OTP). Runs inside the caller's tenant transaction.
   */
  hasProof(shipmentId: string): Promise<boolean>;
}
