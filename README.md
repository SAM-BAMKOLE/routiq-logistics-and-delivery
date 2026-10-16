# LDMS — Logistics & Delivery Management System

A production-grade, multi-tenant backend for logistics companies: take delivery
orders, dispatch drivers, plan optimized routes, and track every shipment
through to proof of delivery.

Built to show real backend architecture at **zero cost** — only free tiers and
self-hosted open-source services.

## Highlights

- **Modular monolith** — 14 bounded contexts behind a NestJS module system.
- **Hexagonal layering** into domain, application, infrastructure and
  presentation, with dependencies pointing inward.
- **Application-enforced tenancy** — every repository query is scoped to the
  active tenant, so isolation does not depend on the database configuration.
- **CQRS** where it pays, domain events between modules, and the outbox pattern
  for reliable async work.
- **A real route optimizer** — CVRPTW implemented in plain TypeScript
  (Clarke-Wright savings, local search, simulated annealing), benchmarked
  against nearest-neighbor.
- **Verifiable** — tests, benchmarks, ADRs and diagrams a reviewer can read in
  minutes.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| **Phase 1** | Core API: scaffold, tenancy, identity/RBAC, shipments, pricing, dispatch, routing, tracking, notifications | 🚧 In progress |
| **Phase 2** | Outbox + embedded relay (done); Redis/BullMQ worker and dispatch saga (deferred) | 🚧 In progress |
| **Phase 3** | Reporting, audit, observability, deployment and docs | ⬜ Not started |

Progress is built one step at a time. See the roadmap in the architecture doc.

## Repository layout

```text
routiq/
  api/               # NestJS backend (single pnpm package)
  web/               # Next.js operator console (single pnpm package)
  bots/              # dummy logistics companies driving the public API
  docs/              # architecture, ADRs, diagrams
    architecture.md
  .github/workflows/ # CI + keep-alive
```

Each package has its own `pnpm-lock.yaml` and is installed separately; there is
no workspace root.

## Getting started

The database is a free [Neon](https://neon.tech) Postgres with PostGIS. No local
Docker is required.

```bash
cd api
pnpm install
cp .env.example .env           # then paste your Neon connection strings
pnpm db:migrate                # applies the schema over the direct (non-pooler) URL
pnpm db:seed:demo              # optional demo tenants + manifest for bots/
pnpm start:dev
```

`DATABASE_URL` should be the **pooled** Neon host (`...-pooler...`); migrations
use `MIGRATION_DATABASE_URL`, the **direct** host, because DDL over a pooler is
unreliable. Both are in the Neon dashboard's connection details.

Then open <http://localhost:3000/docs> for the OpenAPI docs.

### Operator console

```bash
cd web
pnpm install
cp .env.example .env.local
pnpm dev
```

See [`web/README.md`](web/README.md) for routes and demo accounts. If the API
already holds port `3000`, the console lands on `3001` — keep that origin in
the API's `CORS_ORIGINS`.

### Simulated customers

```bash
cd api && pnpm db:seed:demo   # writes api/.demo-seed.json
cd ../bots
pnpm install
pnpm simulate                 # drive real shipments through the HTTP API
```

See [`bots/README.md`](bots/README.md) for scenarios and flags.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — the full system design.
- `docs/adr/` — architecture decision records *(added in phase 3)*.

## License

MIT
