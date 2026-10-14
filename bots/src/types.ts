/**
 * The slice of the Routiq API contract the bots rely on. Kept as plain
 * interfaces (not generated) so the bots double as readable API examples.
 */

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string | null;
    isPlatformAdmin: boolean;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    role: string;
  } | null;
}

export type ShipmentStatus =
  | 'CREATED'
  | 'CONFIRMED'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED_ATTEMPT'
  | 'RETURNED'
  | 'CANCELLED';

export interface Shipment {
  id: string;
  trackingNumber: string;
  publicToken: string;
  customerId: string;
  pickupAddressId: string;
  dropoffAddressId: string;
  status: ShipmentStatus;
  weightKg: number;
  volumeM3: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  priceMinor: number | null;
  currency: string;
  failedAttempts: number;
  driverId: string | null;
  vehicleId: string | null;
  version: number;
  items: Array<{ description: string; quantity: number; weightKg: number | null }>;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  priceMinor: number;
  currency: string;
  distanceMeters: number | null;
  weightKg: number;
  ruleId: string;
  ruleName: string;
  baseFeeMinor: number;
  distanceFeeMinor: number;
  weightFeeMinor: number;
  subtotalMinor: number;
  minFeeMinor: number;
}

export interface Assignment {
  id: string;
  shipmentId: string;
  driverId: string;
  vehicleId: string | null;
  status: 'offered' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
  offeredAt: string;
  expiresAt: string;
  respondedAt: string | null;
  reason: string | null;
}

export interface DispatchCandidate {
  driverId: string;
  membershipId: string;
  vehicleId: string | null;
  distanceMeters: number | null;
  activeAssignments: number;
  capacitySlack: number | null;
  withinRadius: boolean;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface Address {
  id: string;
  customerId: string;
  line1: string;
  city: string;
  region: string | null;
  country: string;
  postalCode: string | null;
}

export interface Proof {
  id: string;
  shipmentId: string;
  type: 'photo' | 'signature' | 'otp';
  fileUrl: string | null;
  recipientName: string | null;
  capturedAt: string;
}

export interface TrackingPoint {
  latitude: number;
  longitude: number;
  recordedAt: string;
  speedKmh?: number;
  heading?: number;
}
