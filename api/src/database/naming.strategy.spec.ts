import { SnakeNamingStrategy, snakeCase } from './naming.strategy.js';

describe('snakeCase', () => {
  it.each([
    ['tenantId', 'tenant_id'],
    ['createdAt', 'created_at'],
    ['TenantMembership', 'tenant_membership'],
    ['URLPath', 'url_path'],
    ['id', 'id'],
    ['line1', 'line1'],
  ])('converts %s to %s', (input, expected) => {
    expect(snakeCase(input)).toBe(expected);
  });
});

describe('SnakeNamingStrategy', () => {
  const strategy = new SnakeNamingStrategy();

  it('snake-cases generated table names', () => {
    expect(strategy.tableName('TenantMembership', undefined)).toBe(
      'tenant_membership',
    );
  });

  it('respects an explicitly specified table name', () => {
    expect(strategy.tableName('Anything', 'custom_table')).toBe('custom_table');
  });

  it('snake-cases column names', () => {
    expect(strategy.columnName('tenantId', undefined, [])).toBe('tenant_id');
    expect(strategy.columnName('createdAt', undefined, [])).toBe('created_at');
    expect(strategy.columnName('id', undefined, [])).toBe('id');
  });

  it('prefixes embedded columns', () => {
    expect(strategy.columnName('line1', undefined, ['address'])).toBe(
      'address_line1',
    );
  });

  it('snake-cases join and junction column names', () => {
    expect(strategy.joinColumnName('tenant', 'id')).toBe('tenant_id');
    expect(strategy.joinTableColumnName('shipment', 'tenantId')).toBe(
      'shipment_tenant_id',
    );
    expect(strategy.joinTableInverseColumnName('shipment', 'driverId')).toBe(
      'shipment_driver_id',
    );
  });
});
