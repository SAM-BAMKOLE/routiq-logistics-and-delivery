import { isRole, roleHasPermission } from './membership.js';

describe('role permissions', () => {
  it('grants the tenant admin everything', () => {
    expect(roleHasPermission('tenant_admin', 'users:invite')).toBe(true);
    expect(roleHasPermission('tenant_admin', 'memberships:update')).toBe(true);
    expect(roleHasPermission('tenant_admin', 'shipments:update-status')).toBe(true);
  });

  it('grants dispatchers operational permissions but no user administration', () => {
    expect(roleHasPermission('dispatcher', 'dispatch:manage')).toBe(true);
    expect(roleHasPermission('dispatcher', 'routes:manage')).toBe(true);
    expect(roleHasPermission('dispatcher', 'users:invite')).toBe(false);
    expect(roleHasPermission('dispatcher', 'memberships:update')).toBe(false);
  });

  it('restricts drivers to their own work', () => {
    expect(roleHasPermission('driver', 'shipments:read-assigned')).toBe(true);
    expect(roleHasPermission('driver', 'shipments:update-status')).toBe(true);
    expect(roleHasPermission('driver', 'shipments:read')).toBe(false);
    expect(roleHasPermission('driver', 'dispatch:manage')).toBe(false);
  });

  it('restricts customers to their own shipments', () => {
    expect(roleHasPermission('customer', 'shipments:create')).toBe(true);
    expect(roleHasPermission('customer', 'shipments:read-own')).toBe(true);
    expect(roleHasPermission('customer', 'routes:manage')).toBe(false);
  });
});

describe('isRole', () => {
  it('accepts the four known roles and rejects everything else', () => {
    expect(isRole('tenant_admin')).toBe(true);
    expect(isRole('driver')).toBe(true);
    expect(isRole('platform_admin')).toBe(false);
    expect(isRole('')).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});
