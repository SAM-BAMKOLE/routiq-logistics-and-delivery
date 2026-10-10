import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import type { EntityManager } from 'typeorm';
import type {
  Address,
  CreateAddressInput,
  UpdateAddressInput,
} from '../domain/customer.js';
import type { AddressRepository } from '../domain/customer.repository.js';

/** Raw row shape for address reads (coordinates extracted from geography). */
interface AddressRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  country: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: Date;
  updated_at: Date;
}

const ADDRESS_COLUMNS = `
  "id", "tenant_id", "customer_id",
  "line1", "line2", "city", "region", "country", "postal_code",
  ST_Y("location"::geometry) AS "latitude",
  ST_X("location"::geometry) AS "longitude",
  "created_at", "updated_at"
`;

/**
 * Address persistence over explicit parameterized SQL.
 *
 * TypeORM's postgres driver has no reliable mapping for `geography(Point)`
 * values, so coordinates bypass the ORM: writes use `ST_MakePoint` and reads
 * extract with `ST_X`/`ST_Y`. Everything stays behind the repository port, so
 * the domain never sees SQL, and every statement is parameterized — never
 * string concatenation. RLS applies to raw SQL exactly as it does to ORM
 * queries, since both run on the transaction's manager.
 */
@Injectable()
export class SqlAddressRepository implements AddressRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async create(
    input: CreateAddressInput & { tenantId: string; customerId: string },
  ): Promise<Address> {
    const rows = (await this.manager().query(
      `INSERT INTO "addresses" (
         "tenant_id", "customer_id", "line1", "line2", "city",
         "region", "country", "postal_code", "location"
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         CASE WHEN $9::double precision IS NULL OR $10::double precision IS NULL
              THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography
         END
       )
       RETURNING ${ADDRESS_COLUMNS}`,
      [
        input.tenantId,
        input.customerId,
        input.line1,
        input.line2 ?? null,
        input.city,
        input.region ?? null,
        input.country,
        input.postalCode ?? null,
        input.longitude ?? null,
        input.latitude ?? null,
      ],
    )) as AddressRow[];
    return toDomain(rows[0]);
  }

  async findById(id: string): Promise<Address | null> {
    const rows = (await this.manager().query(
      `SELECT ${ADDRESS_COLUMNS} FROM "addresses" WHERE "id" = $1`,
      [id],
    )) as AddressRow[];
    return rows.length > 0 ? toDomain(rows[0]) : null;
  }

  async listByCustomer(customerId: string): Promise<Address[]> {
    const rows = (await this.manager().query(
      `SELECT ${ADDRESS_COLUMNS} FROM "addresses"
        WHERE "customer_id" = $1
        ORDER BY "created_at" ASC`,
      [customerId],
    )) as AddressRow[];
    return rows.map(toDomain);
  }

  async update(
    id: string,
    changes: UpdateAddressInput,
  ): Promise<Address | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let index = 1;

    const assign = (column: string, value: unknown): void => {
      sets.push(`"${column}" = $${index}`);
      params.push(value);
      index += 1;
    };

    if (changes.line1 !== undefined) assign('line1', changes.line1);
    if (changes.line2 !== undefined) assign('line2', changes.line2);
    if (changes.city !== undefined) assign('city', changes.city);
    if (changes.region !== undefined) assign('region', changes.region);
    if (changes.country !== undefined) assign('country', changes.country);
    if (changes.postalCode !== undefined)
      assign('postal_code', changes.postalCode);
    if (changes.latitude !== undefined || changes.longitude !== undefined) {
      // Coordinates are a pair: a partial update keeps the stored axis so a
      // latitude-only patch does not wipe the longitude.
      const current = await this.findById(id);
      if (!current) {
        return null;
      }
      const longitude = changes.longitude ?? current.longitude;
      const latitude = changes.latitude ?? current.latitude;
      sets.push(
        `location = CASE WHEN $${index}::double precision IS NULL OR $${index + 1}::double precision IS NULL
              THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($${index}, $${index + 1}), 4326)::geography
         END`,
      );
      params.push(longitude, latitude);
      index += 2;
    }
    if (sets.length === 0) {
      return this.findById(id);
    }

    params.push(id);
    const rows = normalizeRows<AddressRow>(
      await this.manager().query(
        `UPDATE "addresses" SET ${sets.join(', ')}, "updated_at" = now()
        WHERE "id" = $${index}
       RETURNING ${ADDRESS_COLUMNS}`,
        params,
      ),
    );
    return rows.length > 0 ? toDomain(rows[0]) : null;
  }

  async remove(id: string): Promise<boolean> {
    const rows = normalizeRows<{ id: string }>(
      await this.manager().query(
        `DELETE FROM "addresses" WHERE "id" = $1 RETURNING "id"`,
        [id],
      ),
    );
    return rows.length > 0;
  }

  private manager(): EntityManager {
    return this.txHost.tx;
  }
}

/**
 * TypeORM 1.x returns `[rows, affectedCount]` for raw UPDATE/DELETE queries
 * (INSERT stays a flat row array). This normalizes both shapes so callers
 * always see the row array.
 */
function normalizeRows<T>(raw: unknown): T[] {
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
    return raw[0] as T[];
  }
  return raw as T[];
}

function toDomain(row: AddressRow): Address {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    country: row.country,
    postalCode: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
