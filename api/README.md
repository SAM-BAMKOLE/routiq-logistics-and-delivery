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
| `pnpm test:e2e` | End-to-end tests over HTTP |
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
migrations and exercise RLS through the restricted role:

```bash
pnpm test:integration
```

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
  app.module.ts           # root module
  app.setup.ts            # shared HTTP pipeline (prefix, pipes, CORS, Swagger)
  main.ts                 # HTTP entrypoint
test/
  integration/            # PostGIS-backed integration tests (Testcontainers)
```

Module boundaries (domain / application / infrastructure / presentation) arrive
with the feature modules; see the architecture doc.
