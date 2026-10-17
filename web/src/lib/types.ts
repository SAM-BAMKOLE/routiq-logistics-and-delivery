/**
 * Types mirroring the Routiq API responses the dashboard consumes. Kept
 * hand-written so the frontend stays readable and decoupled from codegen.
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
  | "CREATED"
  | "CONFIRMED"
  | "ASSIGNED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "FAILED_ATTEMPT"
  | "RETURNED"
  | "CANCELLED";

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
  items: Array<{
    description: string;
    quantity: number;
    weightKg: number | null;
  }>;
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

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Address {
  id: string;
  customerId: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  country: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface Driver {
  id: string;
  membershipId: string;
  licenseNo: string;
  status: "active" | "suspended";
  availability: "available" | "unavailable";
  currentVehicleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicle {
  id: string;
  plate: string;
  type: string;
  capacityWeightKg: number;
  capacityVolumeM3: number;
  status: string;
}

export interface PricingRule {
  id: string;
  name: string;
  baseFeeMinor: number;
  perKmMinor: number;
  perKgMinor: number;
  minFeeMinor: number;
  priority: number;
  activeFrom: string;
}

export interface Assignment {
  id: string;
  shipmentId: string;
  driverId: string;
  vehicleId: string | null;
  status: "offered" | "accepted" | "rejected" | "expired" | "cancelled";
  offeredAt: string;
  expiresAt: string;
  respondedAt: string | null;
  reason: string | null;
}

export interface Proof {
  id: string;
  shipmentId: string;
  type: "photo" | "signature" | "otp";
  fileUrl: string | null;
  recipientName: string | null;
  capturedAt: string;
  otpVerifiedAt: string | null;
}

export interface DriverLocation {
  driverId: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  recordedAt: string;
}

export interface ShipmentTrack {
  shipmentId: string;
  trackingNumber: string;
  status: string;
  timeline: Array<{ toStatus: string; reason: string | null; occurredAt: string }>;
  proofs: Array<{
    type: string;
    recipientName: string | null;
    capturedAt: string;
    otpVerifiedAt: string | null;
  }>;
  eta: { routeId: string; plannedArrival: string } | null;
  position: DriverLocation | null;
}

export interface PublicTracking {
  trackingNumber: string;
  status: string;
  timeline: Array<{ status: string; occurredAt: string }>;
  eta: string | null;
  position: { latitude: number; longitude: number; recordedAt: string } | null;
}

export interface TenantMember {
  userId: string;
  email: string;
  name: string | null;
  membershipId: string;
  role: string;
  membershipStatus: "active" | "invited" | "suspended";
}

export interface InviteResponse {
  membershipId: string;
  /** Present only when email delivery is disabled (console adapter). */
  inviteUrl?: string;
}

export interface RouteStop {
  id: string;
  shipmentId: string;
  sequence: number;
  kind: string;
  plannedArrival: string | null;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface Route {
  id: string;
  planId: string | null;
  planDate: string;
  status: "planned" | "active" | "completed" | "cancelled";
  vehicleId: string | null;
  driverId: string | null;
  totalDistanceM: number;
  totalDurationS: number;
  algorithm: string;
  stops: RouteStop[];
}

export interface RoutePlan {
  id: string;
  planDate: string;
  status: "planning" | "planned" | "failed";
  strategy: string;
  seed: string | null;
  unassigned: Array<{ stopId: string; reason: string }> | null;
  routesCreated: number | null;
  totalDistanceM: number | null;
  totalDurationM: number | null;
  routes: Route[];
}

export interface ListResponse<T> {
  data: T[];
}
