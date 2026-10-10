import { DefaultNamingStrategy } from 'typeorm';
import type { NamingStrategyInterface } from 'typeorm';

/**
 * Converts a camelCase / PascalCase identifier into snake_case.
 *
 * Ported from TypeORM's own `snakeCase` helper so the behaviour is identical
 * to the default strategy (e.g. `URLPath` -> `url_path`, `tenantId` ->
 * `tenant_id`) without depending on a deep, non-public import.
 */
export function snakeCase(value: string): string {
  return value
    .replace(/([A-Z])([A-Z])([a-z])/g, '$1_$2$3')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Database naming strategy: `camelCase` in code, `snake_case` in the database.
 *
 * TypeORM 1.x already snake-cases *table* names, but column, join-column and
 * junction-column names still follow the property name. This strategy closes
 * that gap so the schema is consistently snake_case everywhere.
 *
 * Explicitly supplied names are respected verbatim, which lets a migration
 * reference a hand-written table without the strategy rewriting it.
 */
export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  override tableName(
    targetName: string,
    userSpecifiedName: string | undefined,
  ): string {
    return userSpecifiedName ?? snakeCase(targetName);
  }

  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    const prefix =
      embeddedPrefixes.length > 0
        ? `${snakeCase(embeddedPrefixes.join('_'))}_`
        : '';
    return prefix + snakeCase(customName ?? propertyName);
  }

  override joinColumnName(
    relationName: string,
    referencedColumnName: string,
  ): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  override joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return snakeCase(`${tableName}_${columnName ?? propertyName}`);
  }

  override joinTableInverseColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return snakeCase(`${tableName}_${columnName ?? propertyName}`);
  }
}
