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
| `pnpm bench:routing` | Routing strategies on deterministic synthetic instances |

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
  `POST /auth/accept-invite`, which sets the password and auto-logs-in).
  The raw token is no longer returned in an HTTP response: the invite
  travels as a branded email through the Notifications module, and the
  e2e suites read it out of the in-memory mailbox. Acceptance marks the
  address verified, so no separate verification flow exists yet.
- Password recovery: `POST /auth/forgot-password` always answers 202 with
  the same body (no account enumeration); known addresses get a
  one-hour, single-use link. `POST /auth/reset-password` consumes it,
  applies the new password, and revokes every existing session. Bad or
  reused tokens are 401s with distinct codes (`RESET_TOKEN_INVALID`,
  `RESET_TOKEN_EXPIRED`).
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
  `ON DELETE RESTRICT`, and the row records its current driver and
  vehicle (`assign` sets them, `release` clears them): a driver may read
  and act on exactly the shipments assigned to them
  (`SHIPMENT_NOT_ASSIGNED` otherwise).

## Dispatch

- `DispatchModule` (`src/modules/dispatch/`): ranked candidate search and
  the offer lifecycle, living in `dispatch_assignments`. The shipment row
  records who is driving (see Shipments above) so driver-scoped reads
  never need this module; the table records the negotiation that put them
  there.
- Candidate search (`GET /shipments/:id/dispatch-candidates`, dispatchers
  only): one PostGIS round trip keeps active, available drivers with no
  live assignment, on shift or without a schedule, in a tenant with a
  free vehicle that fits the shipment's weight and volume. It returns
  each driver's straight-line distance to the pickup (null when no
  position is known), their live-assignment load, a suggested vehicle
  (their own when it fits, else the smallest free fit), and that
  suggestion's spare-capacity slack.
- Radius and ranking are tenant settings (`tenant.settings.dispatch`):
  `radiusStepsKm` (default `[5, 10, 20]`) widens until the first step
  with a located candidate and excludes located drivers beyond it;
  drivers without a position are always listed after the pool (tracking
  fills `driver_locations` in Step 10), and a dispatcher can still name
  any eligible driver manually. `strategy` (default `balanced`) ranks by
  `nearest` distance, `least_loaded` workload, or a weighted blend of
  distance, load, and capacity fit; `offerTtlMinutes` (default 15) and
  `maxCandidates` (default 10) round out the block, and every invalid
  field falls back to its default.
- Lifecycle: `POST /shipments/:id/assignments` opens an offer (`offered`,
  TTL-stamped, the driver's own vehicle defaulted in when it fits);
  drivers answer with `POST /assignments/:id/accept` or `/reject` (their
  own offers only: `drivers:manage-own` plus an ownership check in the
  service); `POST /assignments/:id/cancel` (dispatchers any, drivers
  their own) withdraws a pending offer and releases an accepted one back
  to CONFIRMED. `GET /assignments/me` lists a driver's offers and jobs.
- Accepting drives `CONFIRMED -> ASSIGNED` through the shipments
  service's trusted `applyAssignment` entry point (aggregate, history,
  events, and version included); the offer row and the shipment move in
  one transaction. If the shipment moved under the offer, the offer is
  folded away as `cancelled` and the caller sees the shipment's own 409.
- Concurrency: three partial unique indexes make a live (offered or
  accepted) assignment unique per shipment, per driver, and per vehicle,
  so concurrent double-offers lose with a `23505` the service maps to
  `ASSIGNMENT_ALREADY_OFFERED` / `DISPATCH_DRIVER_BUSY` /
  `DISPATCH_VEHICLE_BUSY` — the phase-1, in-transaction answer to the
  saga's `FOR UPDATE SKIP LOCKED` claim.
- Expiry is lazy in phase 1: dispatch reads sweep the tenant's overdue
  offers (`expired`, `AssignmentExpired` published), and answering a
  lapsed offer is 409 `ASSIGNMENT_EXPIRED`. The phase-2 timeout job
  replaces the sweep (documented tradeoff: two concurrent sweeps can
  double-publish an expiry; best-effort delivery makes that noise, not
  damage).
- Events: `DriverAssigned` (accept), `AssignmentRejected`,
  `AssignmentExpired`, and `AssignmentCancelled`, all published inside
  the tenant transaction. No phase-1 consumer needs them — customers
  already learn about `ASSIGNED` through `ShipmentStatusChanged`.

## Routing

- `RoutingModule` (`src/modules/routing/`): turn a day's confirmed
  shipments into drivable tours — `route_plans` (the run), `routes` (one
  tour, one vehicle), and `route_stops` (a shipment's planned visit),
  all under tenant-forced RLS like the rest of the schema. A unique index
  on `route_stops.shipment_id` makes "planned exactly once" a schema
  invariant, not a service convention.
- Planning is asynchronous over HTTP: `POST /routes/plan` validates the
  day (depot configured → date parses → strategy known → shipments exist
  → within `maxStops` → an active vehicle exists), records the run, and
  answers `202 Accepted` with a `Location` status URL; the caller polls
  `GET /routes/plans/:id` until `planned` (or `failed`, which carries the
  error). Phase 1 executes the plan as a floating in-process task with
  its own tenant transaction — the documented deviation from the
  architecture's Piscina/BullMQ worker, swapped in phase 2 without an
  API change (the 202 + status URL is already the queue's shape).
- Plan input: unrouted `CONFIRMED` shipments whose delivery window
  touches the plan date, active vehicles with their best-fit driver
  (the driver's `current_vehicle_id`), a shift from any `driver_shifts`
  row overlapping the day, else the depot's hours. Shipments without
  geocoded addresses are reported `no_coordinates` before solving; the
  tenant's depot lives in `settings.routing.depot` (latitude/longitude —
  the one setting with no default: a problem with no start point is not
  a problem, so a missing depot is 422 `ROUTING_DEPOT_MISSING`).
- The optimizer (`optimization/`) is pure TypeScript, seeded
  (mulberry32) and iteration-bounded, so the same seed replays the same
  plan — `timeBudgetMs` is only a safety cap. Four strategies behind one
  `getStrategy` registry: `nearest_neighbor` (fast greedy baseline),
  `savings` (Clarke–Wright), `savings_local_search` (savings + 2-opt /
  Or-opt / relocate / swap), and `annealing` (the tenant default).
  Distances are Haversine × a circuity factor (1.3) at an average speed
  (30 km/h) — phase-1 straight-line geometry, noted as such.
- Feasibility is hard, not soft: capacity (weight and volume), delivery
  windows (early arrival waits), and shift/depot closing. One tour per
  vehicle — classic CVRPTW, no multi-tripping — and after merging,
  Clarke–Wright's surplus routes are salvaged into the drafted tours by
  cheapest feasible insertion; whatever still fits nowhere comes back
  with a reason (`no_coordinates`, `capacity_exceeded`,
  `time_window_infeasible`, `shift_exceeded`, `no_feasible_vehicle`) in
  `plan.unassigned`.
- Reads and lifecycle: `GET /routes` (filter by `planDate`/`status`/
  `driverId`), `GET /routes/:id` (ETag carries the version),
  `POST /routes/:id/start` (`planned` → `active`) and
  `POST /routes/:id/replan` (re-solves the remaining stops in place on
  the same vehicle, swapping `route_stops` inside one transaction) —
  both behind `If-Match` like shipments: 428 without it, 412 on a stale
  version, 409 `ROUTE_NOT_STARTABLE` / `ROUTE_NOT_REPLANABLE` when the
  status says no.
- Permissions split as `routes:manage` (dispatchers and admins: plan,
  start, replan, read any route) versus `routes:read-own` (drivers: read
  routes, scoped in the service to their own driver profile — someone
  else's route answers 404, never 403; customers have neither and get
  403 at the guard).
- Events: `RoutePlanned` and `RouteReplanned` (with counts and the
  objective) published inside the tenant transaction, carrying
  `aggregateType: 'route'` for Step 10's tracking work to build on.
- Tradeoffs, phase 1: the in-process executor ties plan latency to the
  API process (fine for one tenant planning a day; the queue fixes it at
  phase 2); the unique stop index means cancelling a route does not yet
  free its shipments for replanning elsewhere (phase 2, alongside route
  cancellation); and windowless long-haul pairs need a depot, hours, and
  speed in tenant settings that actually fit the day.
- Benchmark: `pnpm bench:routing` runs all four strategies on
  deterministic synthetic instances generated in-process (no downloads)
  in the spirit of the public families they imitate — clustered
  (C101-like), random (R101-like), mixed (RC101-like), and a windowless
  200-stop CVRP — with city-scale coordinates around a Lagos-centred
  depot. Representative run:

  | instance | strategy | ms | routes | unassigned | km | objective |
  | --- | --- | ---: | ---: | ---: | ---: | ---: |
  | C101-like | nearest_neighbor | 13.2 | 10 | 18 | 211.1 | 4,311,063 |
  | C101-like | savings | 27.2 | 10 | 2 | 191.6 | 1,091,589 |
  | C101-like | savings_local_search | 32.7 | 10 | 2 | 187.0 | 1,086,962 |
  | C101-like | annealing | 56.3 | 10 | 2 | 182.6 | 1,082,634 |
  | R101-like | nearest_neighbor | 11.8 | 10 | 21 | 287.7 | 4,987,680 |
  | R101-like | savings | 15.4 | 10 | 5 | 305.8 | 1,805,783 |
  | R101-like | savings_local_search | 30.5 | 10 | 5 | 303.0 | 1,803,018 |
  | R101-like | annealing | 50.3 | 10 | 5 | 277.9 | 1,777,853 |
  | RC101-like | nearest_neighbor | 1.5 | 10 | 33 | 229.6 | 7,329,572 |
  | RC101-like | savings | 16.5 | 10 | 3 | 342.9 | 1,442,909 |
  | RC101-like | savings_local_search | 23.2 | 10 | 3 | 334.5 | 1,434,527 |
  | RC101-like | annealing | 38.2 | 10 | 3 | 334.5 | 1,434,527 |
  | CVRP-200 | nearest_neighbor | 4.7 | 10 | 16 | 517.8 | 4,217,781 |
  | CVRP-200 | savings | 54.4 | 10 | 15 | 469.2 | 3,969,235 |
  | CVRP-200 | savings_local_search | 72.0 | 10 | 15 | 468.1 | 3,968,148 |
  | CVRP-200 | annealing | 85.2 | 10 | 15 | 468.1 | 3,968,148 |

  How to read it: the objective (distance ×1, vehicles ×50,000, lateness
  ×100, unassigned ×200,000) is the comparable column, not kilometres —
  strategies that plan more stops necessarily drive farther. Nearest
  neighbour is fastest but strands a quarter of the day; the savings
  family plans nearly everything the hard windows and the ten-vehicle
  fleet allow, and local search or annealing buys a few more per cent of
  distance on top. Every run stays two orders of magnitude under the
  default 2-second budget.

## Notifications and events

- `shared/messaging/`: an in-process event bus. Services publish
  `DomainEventEnvelope`s (id, type, tenant, aggregate + version,
  correlation/causation ids, payload); the `EventEmitterBus` adapter fills
  the correlation id from the request's `x-request-id` (or generates one)
  and delivers through `@nestjs/event-emitter`. Listener failures are
  logged, never surfaced to the raising request — phase 1 is best-effort
  by design; phase 2 moves delivery to an outbox plus a queue.
- Events are published inside the tenant transaction, so listeners see
  the same RLS context as the writer. The email send therefore runs
  inside the request in phase 1 (documented tradeoff: SMTP latency lands
  on the mutating call; the quotas keep the worst case bounded).
- `NotificationsModule` (`src/modules/notifications/`) has no HTTP
  surface: listeners map domain events onto Handlebars templates
  (`<name>.subject.hbs` / `.html.hbs` / `.txt.hbs` wrapped in one shared
  layout, copied into `dist` by the build) and record every attempt in
  `email_log`.
- Each send carries a unique `dedupe_key`
  (`<eventId>:<template>:<recipient>`), so an at-least-once replay mails
  exactly once. Daily quotas (global default 450, per-tenant default
  100) drop `normal`-priority mail with a recorded `skipped_quota` row;
  `critical` mail (invites, resets, delivery outcomes) ignores the
  quota.
- Transports sit behind `EmailPort`, chosen by `EMAIL_ADAPTER`:
  `console` (default), `memory` (tests — an in-process mailbox every
  suite can read), and `gmail` (nodemailer SMTP pool; the app refuses to
  boot without `SMTP_USER`/`SMTP_PASSWORD`). `email_log` is a global
  table with a nullable tenant, following the `refresh_tokens`
  precedent: password reset runs with no tenant at all.
- Template map: shipment confirmed → confirmation; status changes to
  `ASSIGNED`/`OUT_FOR_DELIVERY` → driver-assigned / out-for-delivery;
  delivered → receipt (critical); failed attempt → reason-carrying
  failure (critical). `UserInvited` and `PasswordResetRequested` become
  invite and reset emails (critical); `DeliveryOtpIssued` sends delivery OTP (critical);
  customers without an email address are skipped with a debug log.

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
  modules/dispatch/       # candidate search, assignment lifecycle
  modules/tracking/        # driver locations, shipment points, gateway, retention
  modules/proof-of-delivery/# OTP, proofs, delivery verification
  modules/billing/         # invoices and billing
  modules/reporting/       # reports and exports
  modules/outbox/          # transactional outbox
  modules/idempotency/     # idempotency support
  modules/ratelimits/      # rate limiting support
  modules/geofencing/      # geofencing & ETA
  modules/assets/          # assets & warehouses
  modules/compliance/      # compliance & audit
  modules/hardening/       # final hardening
  modules/notifications/  # listeners, templates, email adapters, email log
  shared/tenancy/         # CLS context, transaction interceptor, tenancy module
  shared/messaging/       # event envelope, bus port, EventEmitter adapter
  app.module.ts           # root module
  app.setup.ts            # shared HTTP pipeline (prefix, pipes, CORS, Swagger)
  main.ts                 # HTTP entrypoint
test/
  e2e/                    # container bootstrapping for the e2e run
  integration/            # PostGIS-backed integration tests (Testcontainers)
```

The Phase-1 build order (tenancy → identity → customers/fleet → pricing →
shipments → dispatch → routing → tracking/POD) and every design decision live in the
[architecture doc](../docs/architecture.md).
