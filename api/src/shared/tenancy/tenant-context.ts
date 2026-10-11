import type { ClsStore } from 'nestjs-cls';

/**
 * The identity of the caller for the duration of one request (or job): which
 * tenant is active, which user is acting, and in what role.
 *
 * The tenant always comes from a verified token, never from a header or the
 * request body, so nothing a client sends can move it to another tenant.
 */
export interface TenantPrincipal {
  tenantId: string;
  userId: string;
  role: string;
  /**
   * Whether the user carries the platform-admin flag. Platform routes check
   * this instead of a tenant role; tenant routes still authorize by role.
   */
  isPlatformAdmin: boolean;
}

/** Key under which the principal is stored in the CLS store. */
export const TENANT_CLS_KEY = 'tenant';

/** Typed CLS store: everything the app stashes per request lives here. */
export interface LdmsClsStore extends ClsStore {
  tenant?: TenantPrincipal;
  /**
   * The request's correlation id (the `x-request-id` header when supplied,
   * otherwise the id pino assigned). Domain events stamp it into their
   * envelope so one request can be traced through everything it caused.
   */
  requestId?: string;
}
