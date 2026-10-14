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
- **Database-enforced tenancy** — Postgres Row-Level Security, not just
  application filtering.
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
| **Phase 1** | Core API: scaffold, tenancy + RLS, identity/RBAC, shipments, pricing, dispatch, routing, tracking, notifications | 🚧 In progress |
| **Phase 2** | Worker process, Redis, BullMQ, outbox pattern, dispatch saga | ⬜ Not started |
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
  docker-compose.yml # local Postgres+PostGIS
  .github/workflows/ # CI + keep-alive
```

Each package has its own `pnpm-lock.yaml` and is installed separately; there is
no workspace root.

## Getting started

```bash
docker compose up -d          # backing services
cd api
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm db:seed:demo             # optional demo tenants + manifest for bots/
pnpm start:dev
```

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
