# LDMS API

Multi-tenant **Logistics & Delivery Management System** API — a NestJS backend
that lets logistics companies take delivery orders, dispatch drivers, plan
optimized routes and track shipments through to proof of delivery.

This package is one half of the project. Architecture, roadmap and design
decisions live in [`../docs`](../docs) and the repo [README](../README.md).

## Stack

| Concern | Choice |
| --- | --- |
| Framework | NestJS 12 (strict TypeScript, ESM) |
| Database | PostgreSQL + PostGIS (Docker locally, Neon/Supabase in the cloud) |
| ORM | TypeORM (migrations only) |
| Job queue | BullMQ + Redis *(phase 2)* |
| Realtime | Socket.IO *(phase 2)* |
| Email | Nodemailer over Gmail SMTP behind an `EmailPort` |
| Validation | `class-validator` / `class-transformer` |
| Docs | `@nestjs/swagger` at `/docs` |
| Logging | `nestjs-pino` (structured JSON) |
| Testing | Jest + Supertest + Testcontainers |
| Linting | oxlint (type-aware) + Prettier |

## Prerequisites

- Node.js >= 22
- pnpm 10+
- Docker (for local Postgres/PostGIS, Redis and Mailpit)

## Getting started

```bash
# from the repository root
docker compose up -d          # Postgres+PostGIS, Redis, Mailpit

cd api
pnpm install
cp .env.example .env          # then adjust values as needed
pnpm db:migrate               # apply schema migrations
pnpm start:dev                # http://localhost:3000
```

Once running:

- API discovery: <http://localhost:3000/api/v1>
- Swagger UI: <http://localhost:3000/docs>
- Liveness: <http://localhost:3000/health/live>
- Readiness: <http://localhost:3000/health/ready>

## Scripts

| Script | Description |
| --- | --- |
| `pnpm start:dev` | Run the API with hot reload |
| `pnpm build` | Compile to `dist/` |
| `pnpm start:prod` | Run the compiled build |
| `pnpm lint` | Type-aware lint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit tests (Jest) |
| `pnpm test:cov` | Unit tests with coverage |
| `pnpm test:e2e` | End-to-end tests over HTTP (throws away its own PostGIS container) |
| `pnpm test:integration` | Integration tests against a throwaway PostGIS container |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:migrate:show` | List applied and pending migrations |
| `pnpm db:migrate:revert` | Roll back the last migration |

## Database

PostgreSQL + PostGIS, accessed through TypeORM with migrations only
(`synchronize` is permanently off — the schema is owned by migrations, so the
running app can never reshape it).

Two roles keep tenants isolated:

| Role | Used by | Can do |
| --- | --- | --- |
| `ldms_owner` | Migrations (`MIGRATION_DATABASE_URL`) | Own tables, run DDL |
| `ldms_app` | The running app (`DATABASE_URL`) | DML only; cannot run DDL; subject to Row Level Security |

Locally, `docker compose up` provisions `ldms_app` on first boot (see
[`../docker/initdb`](../docker/initdb)). Every tenant-owned table is isolated by
calling `enableTenantIsolation(...)` from
[`src/database/rls.ts`](src/database/rls.ts) inside its migration: the helper
turns on and forces RLS, creates the `app.tenant_id` policy and indexes
`tenant_id`, so no table can be forgotten.

Integration tests boot a throwaway PostGIS container (Testcontainers), apply the
migrations and exercise RLS through the restricted role; e2e tests do the same
so the whole HTTP stack runs against real Postgres:

```bash
pnpm test:integration
pnpm test:e2e
```

## Tenancy

Every tenant-scoped request flows through one pipeline, so no endpoint can
forget to isolate:

1. `JwtAuthGuard` verifies the Bearer access token, then revalidates against the
   database — the token is a hint, the database decides: the user must be
   active, the membership must be active, and the tenant must not be
   suspended. The resulting `TenantPrincipal` (`tenantId`, `userId`, `role`,
   `isPlatformAdmin`) goes into the request-scoped context
   ([CLS](src/shared/tenancy/tenant-context.service.ts), backed by
   `AsyncLocalStorage`). Login itself has no token yet, so it lists the
   user's memberships through the `list_user_memberships` SECURITY DEFINER
   function (migration `...0006`), which returns only that user's rows.
2. The global `TenantTransactionInterceptor` opens a transaction and binds
   `app.tenant_id` to it (`SET LOCAL`-equivalent through `set_config`).
3. Repositories resolve their entity manager from the `TransactionHost`, so they
   join that transaction and are filtered by Row Level Security.

Because the setting is transaction-local, a pooled connection is returned to
the pool clean — the next request can never inherit a tenant. Outside a request
(background jobs, tests), the same path is available through
`TenantTransactionService.runWithTenant(...)`.

The `TenantsModule` (`src/modules/tenants/`) manages the global tenant registry
through the four-layer structure (domain → application → infrastructure →
presentation) with a repository port bound to its TypeORM implementation.
`memberships` is the first tenant-scoped table (migration `...0003`), isolated
via `enableTenantIsolation`.

## Platform API

Platform administration is served under `/api/v1/platform/tenants` (create,
list, get, update). It requires a JWT whose `adm` claim is true — the
platform-admin flag on the user, not a tenant role. No tenant context is set
for these requests, so RLS returns no tenant data by design.

The first platform admin cannot log in before existing, so environments are
bootstrapped once with:

```bash
pnpm db:seed:platform-admin --email ops@example.com --password '…' [--name '…']
```

## Identity and RBAC

The `IdentityModule` (`src/modules/identity/`) owns users, memberships,
credentials, and tokens:

- Passwords are hashed with Argon2id; unknown users and wrong passwords
  return the identical `INVALID_CREDENTIALS` 401.
- Access tokens are short-lived JWTs (`sub`, `tid`, `role`, `adm`); refresh
  tokens are opaque, stored by SHA-256 hash only, and rotated on every use.
  Replaying a revoked token revokes the whole token family
  (`REFRESH_TOKEN_REUSED`).
- `POST /auth/switch-tenant` re-scopes a session to another membership of the
  same user, rotating the refresh token as well.
- Invitations are single-use hashed tokens (`POST /users/invitations` →
  `POST /auth/accept-invite`, which sets the password and auto-logs-in). The
  invite token is returned in the response until the Notifications module can
  email it. Email verification and password reset follow the same token shape
  and land with email delivery.
- Roles (`tenant_admin`, `dispatcher`, `driver`, `customer`) map to
  permissions in code; routes declare needs with `@RequirePermissions(...)`
  (any listed permission satisfies the guard), enforced by
  `PermissionsGuard` after `JwtAuthGuard`. A tenant always keeps
  one active admin — demoting or suspending the last one is a 409.

Key environment: `JWT_ACCESS_SECRET` (required), `JWT_ACCESS_TTL` (default
`15m`), `JWT_REFRESH_TTL_DAYS` (default `30`).

## Customers, fleet, and drivers

- `CustomersModule`: customer profiles plus nested addresses
  (`/customers`, `/customers/:id/addresses` with full CRUD on both).
  Coordinates persist as PostGIS `geography(Point, 4326)` with a GiST index;
  the repository uses explicit parameterized SQL for the spatial column
  because TypeORM cannot map `geography` values, and RLS applies to raw SQL
  exactly as to ORM queries.
- `FleetModule`: vehicle registration (`/vehicles` CRUD) with per-tenant
  plate uniqueness (`VEHICLE_PLATE_TAKEN` on collision).
- `DriversModule`: driver profiles linked to memberships (`/drivers` CRUD),
  shifts (`/drivers/:id/shifts`, end-after-start enforced as 422),
  self-service `PATCH /drivers/me/availability`, and dispatcher-managed
  `PATCH /drivers/:id/availability`. Duplicate profiles and licenses map to
  distinct codes (`DRIVER_EXISTS`, `LICENSE_TAKEN`).
- New permissions (`customers:read/manage`, `fleet:manage`, `drivers:*`)
  extend the role map: dispatchers read fleet/drivers and manage customers
  and availability; drivers only touch their own availability.

## Pricing

- `PricingModule`: tenant rate cards (`/pricing-rules` CRUD, tenant_admin
  only via `pricing:read`/`pricing:manage`) and `POST /quotes`, which prices
  a pickup-to-dropoff pair with the same engine shipments use at creation.
- Rules carry `base_fee_minor`, `per_km_minor`, `per_kg_minor`,
  `min_fee_minor`, optional `currency`, priority, and an active window.
  The highest-priority active rule wins (ties break on later `active_from`,
  then id); the price is
  `max(base + perKm × km + perKg × kg, minFee)` in minor units.
- Distance is the haversine between the addresses' stored coordinates
  (null-safe: missing coordinates contribute 0 to the distance fee); no
  active rule is a 422 `NO_ACTIVE_PRICING_RULE`. Currency comes from
  `tenant.settings.currency` (default `NGN`).

## Shipments

- `ShipmentsModule`: `/shipments` with status-scoped lists, `If-Match`
  optimistic concurrency on every state change, append-only
  `shipment_status_history`, and tracking numbers (`SHP-` + 12 Crockford
  base32 chars, collision-retried).
- The state machine has ten statuses and thirteen transitions: cancel only
  before pickup, a failed attempt retries to out-for-delivery until
  `tenant.settings.maxFailedAttempts` (default 3) forces a return, and
  delivered/returned/cancelled are terminal. `requireProofOfDelivery`
  (default false) will block `deliver` with 422 `PROOF_REQUIRED` until
  proof-of-delivery lands in Step 10. The full transition table is asserted
  in [`src/modules/shipments/domain/shipment.spec.ts`](src/modules/shipments/domain/shipment.spec.ts).
- Every action endpoint requires `If-Match` with the version from the
  response `ETag`: missing is 428 `PRECONDITION_REQUIRED`, stale is 412
  `VERSION_MISMATCH`. Shipments are quoted synchronously at creation
  (`price_minor` is never null), addresses and customers are
  `ON DELETE RESTRICT`, and drivers cannot touch unassigned shipments yet
  (`SHIPMENT_NOT_ASSIGNED` until dispatch in Step 8).

## Configuration

Every environment variable is validated at boot with a schema in
[`src/config/env.validation.ts`](src/config/env.validation.ts) — the app refuses
to start with missing or malformed config. See [`.env.example`](.env.example)
for the full list and defaults.

## Layout

```text
src/
  config/                 # env validation
  common/errors/          # RFC 9457 problem+json filter and exceptions
  database/               # data source, naming strategy, migrations, RLS helper
  health/                 # liveness and readiness probes
  modules/tenants/        # tenant registry (domain/app/infrastructure/presentation)
  modules/identity/       # users, memberships, auth, RBAC guards
  modules/customers/      # customer profiles and saved addresses
  modules/fleet/          # vehicles
  modules/drivers/        # driver profiles, shifts, availability
  modules/pricing/        # tenant rate cards and the quote engine
  modules/shipments/      # aggregate, state machine, history, tracking
  shared/tenancy/         # CLS context, transaction interceptor, tenancy module
  app.module.ts           # root module
  app.setup.ts            # shared HTTP pipeline (prefix, pipes, CORS, Swagger)
  main.ts                 # HTTP entrypoint
test/
  e2e/                    # container bootstrapping for the e2e run
  integration/            # PostGIS-backed integration tests (Testcontainers)
```

The Phase-1 build order (tenancy → identity → customers/fleet → pricing →
shipments → …) and every design decision live in the
[architecture doc](../docs/architecture.md).
