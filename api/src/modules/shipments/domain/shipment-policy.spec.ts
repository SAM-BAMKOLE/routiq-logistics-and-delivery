import {
  DEFAULT_SHIPMENT_POLICY,
  shipmentPolicyFrom,
} from './shipment-policy.js';

describe('shipmentPolicyFrom', () => {
  it('falls back to documented defaults on an empty settings bag', () => {
    expect(shipmentPolicyFrom({})).toEqual(DEFAULT_SHIPMENT_POLICY);
    expect(shipmentPolicyFrom({}).maxFailedAttempts).toBe(3);
  });

  it('reads tenant overrides', () => {
    expect(
      shipmentPolicyFrom({ requireProofOfDelivery: true, maxFailedAttempts: 5 }),
    ).toEqual({ requireProofOfDelivery: true, maxFailedAttempts: 5 });
  });

  it('rejects malformed overrides in favor of the defaults', () => {
    expect(
      shipmentPolicyFrom({ requireProofOfDelivery: 'yes', maxFailedAttempts: 2.5 }),
    ).toEqual(DEFAULT_SHIPMENT_POLICY);
    expect(
      shipmentPolicyFrom({ maxFailedAttempts: -1 }),
    ).toEqual(DEFAULT_SHIPMENT_POLICY);
  });
});
