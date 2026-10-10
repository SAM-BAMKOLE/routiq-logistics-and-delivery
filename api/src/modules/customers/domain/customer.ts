/**
 * A customer in domain terms: who the tenant delivers for. `userId` links an
 * optional portal login; everything else is plain profile data owned by the
 * tenant.
 */
export interface Customer {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly userId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateCustomerInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  userId?: string | null;
}

export interface UpdateCustomerInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  userId?: string | null;
}

/**
 * A saved address. Coordinates are plain numbers in the domain; the
 * infrastructure layer translates them to and from the PostGIS `geography`
 * column, which stays NULL until coordinates are known (geocoding lands with
 * routing).
 */
export interface Address {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly region: string | null;
  readonly country: string;
  readonly postalCode: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateAddressInput {
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  country: string;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface UpdateAddressInput {
  line1?: string;
  line2?: string | null;
  city?: string;
  region?: string | null;
  country?: string;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}
