/**
 * Tenant-level shipment rules, read from the tenant's `settings` jsonb with
 * documented defaults. Pure: no database, no framework.
 */
export interface ShipmentPolicy {
  /** Delivering demands proof of delivery when enabled. */
  readonly requireProofOfDelivery: boolean;
  /** After this many failed attempts only a return is allowed. */
  readonly maxFailedAttempts: number;
}

export const DEFAULT_SHIPMENT_POLICY: ShipmentPolicy = {
  requireProofOfDelivery: false,
  maxFailedAttempts: 3,
};

export function shipmentPolicyFrom(
  settings: Record<string, unknown>,
): ShipmentPolicy {
  const requireProof = settings['requireProofOfDelivery'];
  const maxAttempts = settings['maxFailedAttempts'];
  return {
    requireProofOfDelivery:
      typeof requireProof === 'boolean'
        ? requireProof
        : DEFAULT_SHIPMENT_POLICY.requireProofOfDelivery,
    maxFailedAttempts:
      typeof maxAttempts === 'number' && Number.isInteger(maxAttempts) && maxAttempts > 0
        ? maxAttempts
        : DEFAULT_SHIPMENT_POLICY.maxFailedAttempts,
  };
}
