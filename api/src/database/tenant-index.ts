import type { QueryRunner } from 'typeorm';

/**
 * Conservative allow-list for SQL identifiers we interpolate. Every table and
 * index name in this codebase is a lower_snake_case developer constant, never
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

/**
 * Gives a tenant-scoped table the index every access path relies on.
 *
 * Tenant isolation is enforced in the application layer: repositories filter
 * by the active tenant (`tenant_id = <current tenant>`), and services verify
 * ownership before acting. This helper only guarantees `tenant_id` is indexed,
 * so those filters stay fast. The caller is responsible for declaring the
 * `tenant_id uuid NOT NULL` column and its foreign key in the `CREATE TABLE`;
 * this fails loudly if the column is missing rather than silently leaving an
 * unindexed table.
 */
export async function createTenantIndex(
  queryRunner: QueryRunner,
  table: string,
  tenantColumn = 'tenant_id',
): Promise<void> {
  const tableName = quoteIdentifier(table);
  const columnName = quoteIdentifier(tenantColumn);
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
      `Cannot index "${table}": column "${tenantColumn}" does not exist. ` +
        'Declare it in the CREATE TABLE before calling createTenantIndex.',
    );
  }

  await queryRunner.query(
    `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columnName})`,
  );
}
