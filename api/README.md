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

1. A guard (next step: JWT auth) verifies the caller and puts a `TenantPrincipal`
   (`tenantId`, `userId`, `role`) into the request-scoped context
   ([CLS](src/shared/tenancy/tenant-context.service.ts), backed by
   `AsyncLocalStorage`).
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
list, get, update). It is guarded by an **interim** shared secret sent as the
`x-platform-admin-key` header, configured with `PLATFORM_ADMIN_API_KEY`. When
the identity module lands, this is replaced by JWT verification with the
`is_platform_admin` claim — the routes and contract stay the same.

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
