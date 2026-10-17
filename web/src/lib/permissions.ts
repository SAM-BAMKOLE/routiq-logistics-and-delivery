/**
 * Frontend mirror of the API's role → permission map (see the API's
 * `identity/domain/membership.ts`). It exists only to hide actions a role
 * cannot perform; the API remains the source of truth and re-checks every
 * request, so a stale copy here can never grant access — at worst it hides a
 * button that would have been rejected anyway.
 */

export type Role = "tenant_admin" | "dispatcher" | "driver" | "customer";

const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  tenant_admin: ["*"],
  dispatcher: [
    "customers:read",
    "customers:manage",
    "shipments:create",
    "shipments:read",
    "shipments:update",
    "dispatch:manage",
    "routes:manage",
    "fleet:read",
    "drivers:read",
    "drivers:manage-availability",
    "tracking:read",
    "reports:read",
  ],
  driver: [
    "shipments:read-assigned",
    "shipments:update-status",
    "routes:read-own",
    "drivers:manage-own",
    "tracking:push",
    "profile:read-own",
  ],
  customer: [
    "shipments:create",
    "shipments:read-own",
    "quotes:create",
    "profile:read-own",
  ],
};

export function roleHasPermission(
  role: string | null | undefined,
  permission: string,
): boolean {
  if (!role) return false;
  const permissions = ROLE_PERMISSIONS[role as Role];
  if (!permissions) return false;
  return permissions.includes("*") || permissions.includes(permission);
}

/** Human label for a role, for badges and selects. */
export function roleLabel(role: string): string {
  switch (role) {
    case "tenant_admin":
      return "Admin";
    case "dispatcher":
      return "Dispatcher";
    case "driver":
      return "Driver";
    case "customer":
      return "Customer";
    default:
      return role;
  }
}
