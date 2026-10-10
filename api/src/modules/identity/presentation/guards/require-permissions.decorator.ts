import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../../domain/membership.js';

/** Metadata key for route-required permissions. */
export const PERMISSIONS_KEY = 'ldms:permissions';

/**
 * Names the permissions a route needs, e.g.
 * `@RequirePermissions('users:invite')`. Roles map to permissions in
 * {@link ROLE_PERMISSIONS}; `tenant_admin` holds `'*'`.
 */
export const RequirePermissions = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);
