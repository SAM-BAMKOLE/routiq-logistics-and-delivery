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
  api/               # the NestJS API (this phase)
  docs/              # architecture, ADRs, diagrams
    architecture.md
  docker-compose.yml # local Postgres+PostGIS, Redis, Mailpit
  .github/workflows/ # CI
```

## Getting started

```bash
docker compose up -d          # backing services
cd api
pnpm install
cp .env.example .env
pnpm start:dev
```

Then open <http://localhost:3000/docs> for the OpenAPI docs.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — the full system design.
- `docs/adr/` — architecture decision records *(added in phase 3)*.

## License

MIT
