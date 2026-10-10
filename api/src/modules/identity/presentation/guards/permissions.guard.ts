import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContextService } from '../../../../shared/tenancy/tenant-context.service.js';
import {
  isRole,
  roleHasPermission,
  type Permission,
} from '../../domain/membership.js';
import { PERMISSIONS_KEY } from './require-permissions.decorator.js';

/**
 * Authorizes tenant-scoped requests by role permission. Runs after
 * {@link JwtAuthGuard}, which establishes the principal; routes without
 * `@RequirePermissions` pass through.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: TenantContextService,
  ) {}

  canActivate(executionContext: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        executionContext.getHandler(),
        executionContext.getClass(),
      ]) ?? [];
    if (required.length === 0) {
      return true;
    }

    const principal = this.context.get();
    const role = principal?.role;
    if (!principal?.tenantId || !isRole(role)) {
      throw new ForbiddenException({
        message: 'This route requires a tenant-scoped session.',
        code: 'TENANT_CONTEXT_REQUIRED',
      });
    }

    // Any-of semantics: a route can accept several alternatives, e.g.
    // `@RequirePermissions('shipments:read', 'shipments:read-own')` lets
    // dispatchers and customers through, and the application layer then
    // scopes what each of them may see.
    const allowed = required.some((permission) =>
      roleHasPermission(role, permission),
    );
    if (!allowed) {
      throw new ForbiddenException({
        message: `The '${role}' role cannot perform this action.`,
        code: 'PERMISSION_DENIED',
      });
    }
    return true;
  }
}
