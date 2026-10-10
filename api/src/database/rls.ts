import type { QueryRunner } from 'typeorm';

/**
 * Conservative allow-list for SQL identifiers we interpolate. Every table and
 * policy name in this codebase is a lower_snake_case developer constant, never
 * user input, but validating keeps the helper safe by construction.
 */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function quoteIdentifier(identifier: string): string {
  if (!SAFE_IDENTIFIER.test(identifier)) {
    throw new Error(
      `Refusing to use unsafe SQL identifier "${identifier}". ` +
        'Identifiers must match /^[a-z_][a-z0-9_]*$/.',
    );
  }
  return `"${identifier}"`;
}

export interface TenantIsolationOptions {
  /** Column holding the owning tenant. Defaults to `tenant_id`. */
  tenantColumn?: string;
  /** Name of the RLS policy. Defaults to `tenant_isolation`. */
  policyName?: string;
}

/**
 * Turns a table into a tenant-scoped table by enforcing Row Level Security.
 *
 * It is the single, shared way the schema applies isolation, so no table is
 * forgotten. The caller is responsible for declaring the `tenant_id uuid NOT
 * NULL` column and its foreign key in the `CREATE TABLE`; this helper fails
 * loudly if the column is missing rather than silently producing a table that
 * leaks across tenants.
 *
 * The policy reads the current tenant from the transaction-local setting
 * `app.tenant_id` (see the request pipeline which sets it per transaction),
 * and `FORCE ROW LEVEL SECURITY` ensures even the table owner is subject to it.
 */
export async function enableTenantIsolation(
  queryRunner: QueryRunner,
  table: string,
  options: TenantIsolationOptions = {},
): Promise<void> {
  const tenantColumn = options.tenantColumn ?? 'tenant_id';
  const policyName = options.policyName ?? 'tenant_isolation';

  const tableName = quoteIdentifier(table);
  const columnName = quoteIdentifier(tenantColumn);
  const policy = quoteIdentifier(policyName);
  const indexName = quoteIdentifier(`idx_${table}_${tenantColumn}`);

  const exists = await queryRunner.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2`,
    [table, tenantColumn],
  );
  if (exists.length === 0) {
    throw new Error(
      `Cannot isolate "${table}": column "${tenantColumn}" does not exist. ` +
        'Declare it in the CREATE TABLE before calling enableTenantIsolation.',
    );
  }

  const predicate = `${columnName} = NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

  await queryRunner.query(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
  await queryRunner.query(`ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY`);
  await queryRunner.query(`DROP POLICY IF EXISTS ${policy} ON ${tableName}`);
  await queryRunner.query(
    `CREATE POLICY ${policy} ON ${tableName}
       USING (${predicate})
       WITH CHECK (${predicate})`,
  );
  // tenant_id leads every access path, so it always gets its own index.
  await queryRunner.query(
    `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columnName})`,
  );
}
