# Logistics & Delivery Management System: Architecture

Oct 9, 2026 · @Samuel

## Overview

LDMS is a multi-tenant NestJS backend that lets logistics companies take delivery orders, dispatch drivers, plan optimized routes, and track each shipment through to proof of delivery. It is a backend-only portfolio project built to show production-grade architecture at zero cost.

**Goals**

- Demonstrate advanced backend design: modular monolith, hexagonal layering, CQRS, domain events, and the outbox pattern.
- Enforce tenant isolation inside the database with Postgres Row-Level Security (RLS).
- Implement a real vehicle routing algorithm (CVRPTW) instead of calling a black-box service.
- Run entirely on free services, with email sent through Gmail SMTP.
- Stay verifiable: tests, benchmarks, ADRs, and diagrams a reviewer can read in minutes.

**Actors**

| Actor | Scope | Main capabilities |
| --- | --- | --- |
| Platform admin | Whole platform | Create and suspend tenants, view platform metrics |
| Tenant admin | One tenant | Manage users, roles, pricing rules, settings |
| Dispatcher | One tenant | Confirm shipments, assign drivers, plan and adjust routes |
| Driver | One tenant | Accept jobs, update status, stream location, capture proof of delivery |
| Customer | One tenant | Request quotes, create shipments, track deliveries |

**Success criteria**

- A tenant can run the full flow: quote, shipment, dispatch, route, delivery, email receipt.
- A cross-tenant read attempt fails at the database level, proven by an automated test.
- The route optimizer beats a nearest-neighbor baseline on benchmark instances, with the results published in the README.
- The whole system starts with `docker compose up` and deploys on free tiers.

## Constraints, assumptions and non-goals

The system must cost nothing to build, run, and demo, so every design choice is bounded by free-tier limits.

| Constraint | Consequence for the design |
| --- | --- |
| Zero spend | Only free tiers or self-hosted Docker services. No Google Maps, paid email, or paid hosting. |
| Email through Gmail SMTP with an App Password | Roughly 500 messages a day for one account, shared by all tenants. The sender address is always the authenticated Gmail account. |
| Free hosting sleeps or has small memory limits | One API process and one worker. Cold starts are accepted and documented. |
| Free Postgres has small storage and connection limits | Careful pooling, batched writes, and a retention window for location history. |
| Public OSRM and Nominatim servers have fair-use limits | Cache matrix and geocoding results, fall back to Haversine distances, and never call them from tests. |

**Assumptions**

- One deployment region and one currency per tenant.
- Deliveries happen by road inside a single country.
- Drivers and customers use external clients that talk to this API. No client is built here.

**Non-goals**

- No frontend or native driver app.
- No payment processing or tenant billing.
- No machine-learning ETA prediction.
- No integrations with external carriers or 3PL providers.
- No multi-region or active-active deployment.

## Architectural style and principles

LDMS is a modular monolith with strict module boundaries, domain events between modules, and a second process for background work. This gives the design discipline of microservices without their operational cost, and any module can later be extracted into a service.

| Principle | What it means here | Why |
| --- | --- | --- |
| Modular monolith | One repository and one deployable. Each bounded context is a NestJS module with a public API and no deep imports. | Free tiers cannot host many services, and boundaries are what reviewers look for. |
| Hexagonal layers | Each module has domain, application, infrastructure, and presentation layers. Dependencies point inward. | The domain stays testable and independent of TypeORM, Redis, and Nodemailer. |
| CQRS where it pays | Commands and queries are separate in shipments, dispatch, and routing. Simple CRUD modules stay simple. | Avoids ceremony in modules that do not need it. |
| Domain events | Modules react to events instead of calling each other. Events leave through an outbox in phase 2. | Loose coupling and reliable delivery of side effects. |
| Database-enforced tenancy | Tenant isolation is a Postgres RLS policy, not only application filtering. | A bug in application code cannot leak another tenant's data. |
| Ports and adapters for external services | Email, maps, storage, and distance matrices sit behind interfaces. | Free services can be swapped or faked without touching the domain. |
| Pure algorithms | Pricing, the state machine, and route optimization are plain TypeScript with no framework imports. | Deterministic unit tests and benchmarks. |

**Dependency rules**

- Presentation depends on application. Application depends on domain. Infrastructure implements ports declared by application and domain.
- A module may import another module's public facade or its events, never its entities or repositories.
- Shared code lives in a small `shared/kernel` with base classes and primitives. It holds no business logic.

## Technology stack

Every component below is free, either as a hosted free tier or as a Docker container you run yourself.

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | NestJS with strict TypeScript | Modules, DI, guards, interceptors, WebSocket gateways |
| Database | PostgreSQL with PostGIS | Neon or Supabase free tier in the cloud, Docker locally |
| ORM | TypeORM | Migrations only. Spatial queries written as raw query-builder expressions. |
| Transaction and tenant context | `nestjs-cls` with `@nestjs-cls/transactional` (TypeORM adapter) | Per-request transaction and ambient tenant context |
| Cache and pub/sub | Redis | Upstash free tier or Docker. Added in phase 2 for queues. |
| Job queue | BullMQ via `@nestjs/bullmq` | Email, route optimization, reports. Phase 2. |
| Events (phase 1) | `@nestjs/event-emitter` | Replaced by outbox plus BullMQ in phase 2 |
| Real time | Socket.IO gateway | Live tracking and dispatcher updates |
| Road distances | OSRM public server or OpenRouteService free key | Cached, with a Haversine fallback |
| Geocoding | OpenStreetMap Nominatim | Respect its usage policy and cache results |
| Email | Nodemailer over Gmail SMTP with an App Password | Behind an `EmailPort` |
| File storage | Cloudinary or Supabase Storage free tier | Proof-of-delivery photos and signatures |
| Validation | `class-validator` and `class-transformer` | Global validation pipe |
| API docs | `@nestjs/swagger` | OpenAPI served at `/docs` |
| Logging | `nestjs-pino` | Structured JSON with request and tenant IDs |
| Metrics and health | `@willsoto/nestjs-prometheus`, `@nestjs/terminus` | `/metrics` and `/health` |
| Error tracking | Sentry free tier | Optional |
| Testing | Jest, Supertest, Testcontainers | Real Postgres in integration tests |
| CI/CD | GitHub Actions | Free for public repositories |
| Containers | Docker and Docker Compose | One command to run everything locally |
| Hosting | Render, Fly.io, or an Oracle Cloud Always Free VM | Free tiers may sleep, so document cold starts |

Google Maps is excluded because it requires a billing account.

## System context and deployment topology

Two NestJS processes share one codebase and one Postgres database, and reach four free external services through ports. Phase 1 runs only the API process, and phase 2 adds the worker and Redis.

&#91;embedded content: runtime topology · 2 processes, 2 data stores, 4 external services\]

In phase 2 the API process hands slow work to the worker through the outbox. The worker relays events into Redis queues and makes most calls to external services.

**Runtime components**

| Component | Phase | Role |
| --- | --- | --- |
| API process | 1 | REST controllers, Socket.IO gateway, authentication, command and query handling, in-process events |
| Worker process | 2 | Outbox relay, queue processors for email, routing, events, and maintenance, and the route optimizer thread pool |
| PostgreSQL with PostGIS | 1 | System of record with RLS, plus the outbox and audit tables |
| Redis | 2 | BullMQ queues, latest driver positions, email quota counters, Socket.IO adapter |
| Gmail SMTP | 1 | Outbound email |
| OSRM or OpenRouteService | 1 | Road distance and duration matrices, cached |
| Nominatim | 1 | Address geocoding, cached |
| Object storage | 1 | Proof-of-delivery photos and signatures |

In phase 1 the API process calls the external services and runs the optimizer itself. In phase 2 it hands slow work to the worker through the outbox and keeps only the calls a request must wait for, such as geocoding an address.

## Module map

LDMS has 14 bounded contexts. Each owns its tables and talks to the others through events or a small public facade.

| Module | Responsibility | Publishes | Consumes |
| --- | --- | --- | --- |
| Tenants | Tenant profile, settings, plan limits, status | TenantCreated, TenantSuspended | none |
| Identity | Users, memberships, credentials, tokens, roles, permissions | UserInvited, UserRegistered | TenantCreated |
| Customers | Customer profiles, saved addresses, contacts | CustomerCreated | none |
| Fleet | Vehicles, capacity, status, maintenance windows | VehicleStatusChanged | none |
| Drivers | Driver profiles, licences, shifts, availability | DriverAvailabilityChanged | none |
| Pricing | Rate cards and the quote engine | none | none |
| Shipments | Shipment aggregate, items, state machine, tracking number | ShipmentCreated, ShipmentConfirmed, ShipmentStatusChanged, ShipmentDelivered, ShipmentFailed | DriverAssigned, ProofCaptured |
| Dispatch | Candidate search, offers, assignments, reassignment | DriverAssigned, AssignmentRejected, AssignmentExpired | ShipmentConfirmed, ShipmentStatusChanged, DriverAvailabilityChanged |
| Routing | Route planning, optimization, stop ETAs | RoutePlanned, RouteReplanned | DriverAssigned, ShipmentConfirmed |
| Tracking | Location ingest, latest position, history, public tracking view | LocationUpdated | ShipmentStatusChanged |
| Proof of Delivery | Photo, signature, and OTP confirmation | ProofCaptured | ShipmentStatusChanged |
| Notifications | Email, in-app push events, templates, daily quotas | EmailSent, EmailFailed | Shipment events, UserInvited |
| Reporting | KPIs, delivery performance, driver statistics (read models) | none | ShipmentDelivered, ShipmentFailed, RoutePlanned |
| Audit | Immutable activity log | none | All domain events |

**Ownership rules**

- Shipments is the only module that changes a shipment's status. Other modules ask it through its application API or emit events it consumes.
- Pricing exposes a facade that Shipments calls synchronously, because a quote is needed in the same request.
- Reporting reads only from its own read models, built from events.

## Module layering and repository layout

Every non-trivial module uses four layers. Simple CRUD modules (Customers, Fleet) may collapse the domain and infrastructure layers into one persistence class, and that choice is recorded in an ADR.

| Layer | Contains | May depend on |
| --- | --- | --- |
| Domain | Entities, value objects, aggregates, domain events, state machine, domain services, repository ports | Nothing outside `shared/kernel` |
| Application | Commands, queries, handlers, application services, DTO-independent result types, outbound ports (email, maps) | Domain |
| Infrastructure | TypeORM entities and repositories, mappers, adapters (Gmail, OSRM, storage), queue processors | Application, Domain |
| Presentation | Controllers, request and response DTOs, WebSocket gateways, guards, Swagger decorators | Application |

Persistence entities live in infrastructure and are mapped to domain entities, so the domain never imports TypeORM decorators.

```text
src/
  main.ts                  # HTTP API entrypoint
  worker.ts                # background worker entrypoint (phase 2)
  app.module.ts
  worker.module.ts
  modules/
    tenants/ identity/ customers/ fleet/ drivers/ pricing/
    shipments/
      domain/              # Shipment aggregate, ShipmentStatus, events, ports
      application/         # commands, queries, handlers
      infrastructure/      # persistence entities, repositories, mappers
      presentation/        # controllers, DTOs
      shipments.module.ts
    dispatch/ routing/ tracking/ proof-of-delivery/
    notifications/ reporting/ audit/
  shared/
    kernel/                # base entity, aggregate root, Result, DomainEvent
    tenancy/               # tenant context, RLS helpers, guards
    outbox/                # outbox entity and relay (phase 2)
    messaging/             # event bus abstraction
    config/ logging/ errors/ http/
  database/
    data-source.ts
    migrations/
    seeds/
test/
  e2e/ integration/
docs/
  adr/ diagrams/
docker-compose.yml
.github/workflows/
```

One repository serves both processes. `main.ts` boots the HTTP application and `worker.ts` boots the same modules with queue processors enabled and no HTTP listener.

## Multi-tenancy

All tenants share one database and schema. Every tenant-owned table carries a `tenant_id`, and Postgres Row-Level Security filters every query by the tenant set on the current transaction. Schema-per-tenant and database-per-tenant were rejected: the first makes TypeORM migrations painful, the second is impossible on free tiers.

**Request flow**

1. The client sends a JWT containing the user ID (`sub`), the active tenant ID (`tid`), and the role.
2. A guard verifies the token, then checks that the membership is active and the tenant is not suspended.
3. The tenant ID is stored in request-scoped context (`nestjs-cls`, backed by AsyncLocalStorage).
4. A transactional interceptor opens a transaction and runs `SELECT set_config('app.tenant_id', $1, true)`, the bind-parameter form of `SET LOCAL`.
5. Repositories use the transaction's entity manager, so every query runs under the tenant's policy.
6. On commit or rollback the setting disappears, and the pooled connection carries nothing to the next request.

The tenant always comes from the verified token. Headers and request bodies are never trusted for it.

**Policy template** (applied to every tenant-owned table by a migration helper)

```sql
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON shipments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

When no tenant is set, the expression is NULL and the query sees no rows. The failure mode is empty, never open.

**Database roles**

| Role | Used by | Rights |
| --- | --- | --- |
| `ldms_owner` | Migrations only | Owns tables, creates policies |
| `ldms_app` | API and worker at runtime | Data changes only. Not a superuser, no `BYPASSRLS`, not the table owner. |

**Global and tenant-scoped data**

- Global tables: `tenants` and `users`. Access is controlled by application authorization.
- Tenant-scoped tables: everything else, including `memberships`.
- Login must list a user's memberships across tenants, so it calls a `SECURITY DEFINER` function that returns only that user's rows.

**Gotchas to document in an ADR**

| Risk | Mitigation |
| --- | --- |
| Table owners bypass RLS | Runtime role is not the owner, and `FORCE ROW LEVEL SECURITY` is set |
| Pooled connections leak session settings | Only transaction-local settings are used |
| Background jobs run without a request | Every job payload carries `tenantId`, and the processor opens a tenant transaction before any query |
| Unique constraints collide across tenants | Composite uniques such as `UNIQUE (tenant_id, tracking_number)` |
| Indexes get slow with many tenants | `tenant_id` leads composite indexes |
| Migrations and seeds need to see all rows | They run as `ldms_owner` and never from the API process |

**Tenant-aware features**

- Plan limits per tenant, such as maximum vehicles and monthly shipments, enforced in application services.
- Per-tenant daily email quota, so one tenant cannot use up the shared Gmail allowance.
- Per-tenant rate limits on the API.
- Tenant ID in every log line, metric label, and audit record.

A dedicated integration test proves isolation: it seeds two tenants, then deliberately runs an unfiltered `SELECT` under tenant A and asserts that no tenant B row appears.

## Identity, authentication and RBAC

Users are global, roles belong to memberships, and every request is authorized by role permissions plus resource ownership. A person can hold different roles in different tenants.

**Authentication**

- Email and password, hashed with Argon2.
- Short-lived JWT access tokens of about 15 minutes, carrying `sub`, `tid`, and `role`.
- Opaque refresh tokens, stored hashed, with rotation on every use. Reuse of an old token revokes the whole token family.
- Tenant switching: `POST /auth/switch-tenant` exchanges a refresh token for an access token scoped to another membership.
- Invitations, email verification, and password reset use single-use tokens with an expiry, stored hashed and delivered by email through the Notifications module.
- Login and token endpoints have strict throttling.

**Roles and access**

| Role | Shipments | Dispatch and routes | Fleet and drivers | Users and settings | Reports |
| --- | --- | --- | --- | --- | --- |
| Platform admin | None | None | None | Create and suspend tenants only | Platform metrics |
| Tenant admin | Full | Full | Full | Full | Full |
| Dispatcher | Create, read, update all | Full | Read, manage availability | None | Read |
| Driver | Read assigned, update status | Read own route, accept or reject offers | Own profile and availability | None | None |
| Customer | Create, read own | None | None | Own profile | None |

The platform admin is a flag on the user, not a tenant role. With no tenant context, RLS returns no tenant data to this role by design.

**Authorization layers**

1. A role guard checks the permission named on the route, for example `@RequirePermissions('shipment:create')`. Roles map to permissions in code.
2. Application policies check ownership, such as a driver reading only shipments assigned to them or a customer reading only their own.
3. RLS backstops both by guaranteeing no cross-tenant access, even if a policy is wrong.

**Public access**

The public tracking endpoint needs no login. It is addressed by tracking number plus a random public token, returns a minimal view, and is rate limited per IP.

## Data model and schema

The schema has about 20 tables. All except `tenants` and `users` carry `tenant_id` and an RLS policy, and every change goes through a TypeORM migration.

**Conventions**

- UUID primary keys and `timestamptz` columns, with `created_at` and `updated_at` on every table.
- Money stored as integer minor units plus a currency code. Weights in kilograms, distances in meters, durations in seconds.
- Soft deletes (`deleted_at`) on business entities. History and audit tables are append-only.
- A `version` column on aggregates that need optimistic locking, such as shipments and routes.
- Names are snake\_case in the database and camelCase in code, via a naming strategy.

**Tables**

| Table | Key columns | Notes |
| --- | --- | --- |
| `tenants` | id, name, slug, status, plan, settings (jsonb) | Global |
| `users` | id, email, password\_hash, is\_platform\_admin, email\_verified\_at, status | Global. Email unique. |
| `memberships` | id, tenant\_id, user\_id, role, status | Unique (tenant\_id, user\_id) |
| `refresh_tokens` | id, user\_id, tenant\_id, family\_id, token\_hash, expires\_at, revoked\_at | Rotation and reuse detection |
| `customers` | id, tenant\_id, name, email, phone, user\_id | `user_id` is optional for portal customers |
| `addresses` | id, tenant\_id, customer\_id, line1, city, region, country, postal\_code, location | `location` is `geography(Point, 4326)` with a GiST index |
| `vehicles` | id, tenant\_id, plate, type, capacity\_weight\_kg, capacity\_volume\_m3, status | Unique (tenant\_id, plate) |
| `drivers` | id, tenant\_id, membership\_id, license\_no, status, current\_vehicle\_id |  |
| `driver_shifts` | id, tenant\_id, driver\_id, starts\_at, ends\_at | Drives availability |
| `pricing_rules` | id, tenant\_id, name, base\_fee\_minor, per\_km\_minor, per\_kg\_minor, min\_fee\_minor, priority, active\_from | Evaluated by the quote engine |
| `shipments` | id, tenant\_id, tracking\_number, customer\_id, pickup\_address\_id, dropoff\_address\_id, status, weight\_kg, volume\_m3, window\_start, window\_end, price\_minor, currency, version | Unique (tenant\_id, tracking\_number). Indexes on (tenant\_id, status) and (tenant\_id, customer\_id). |
| `shipment_items` | id, tenant\_id, shipment\_id, description, quantity, weight\_kg |  |
| `shipment_status_history` | id, tenant\_id, shipment\_id, from\_status, to\_status, actor\_id, reason, occurred\_at | Append-only |
| `dispatch_assignments` | id, tenant\_id, shipment\_id, driver\_id, vehicle\_id, status, offered\_at, expires\_at, responded\_at | Partial unique index allows one active assignment per shipment |
| `routes` | id, tenant\_id, vehicle\_id, driver\_id, plan\_date, status, total\_distance\_m, total\_duration\_s, algorithm, objective\_value, version |  |
| `route_stops` | id, tenant\_id, route\_id, shipment\_id, sequence, kind, planned\_arrival, window\_start, window\_end | Kind is pickup or dropoff |
| `driver_locations` | id, tenant\_id, driver\_id, recorded\_at, location, speed\_kmh, heading | Index on (driver\_id, recorded\_at desc), with a retention job |
| `proofs_of_delivery` | id, tenant\_id, shipment\_id, type, file\_url, recipient\_name, otp\_verified\_at, captured\_at | Photo, signature, or OTP |
| `email_log` | id, tenant\_id, recipient, template, dedupe\_key, status, error, sent\_at | Feeds quota counting |
| `audit_logs` | id, tenant\_id, actor\_id, action, entity\_type, entity\_id, diff (jsonb), occurred\_at | Append-only |
| `idempotency_keys` | id, tenant\_id, key, request\_hash, response (jsonb), expires\_at | Unique (tenant\_id, key) |
| `outbox_messages` | id, tenant\_id (nullable), event\_type, event\_id (unique), envelope (jsonb), status, attempts, last\_error, available\_at, locked\_at, created\_at, processed\_at | Transactional outbox, global (no RLS) |

**TypeORM notes**

- Migrations only. `synchronize` is off, and a standalone `data-source.ts` serves the CLI.
- `@VersionColumn` provides optimistic locking on shipments and routes. Dispatch claims candidates with `SELECT ... FOR UPDATE SKIP LOCKED`.
- Spatial queries (`ST_DWithin`, `ST_Distance`) are written as raw query-builder expressions with parameters, never string concatenation.
- List endpoints use keyset (cursor) pagination on `(created_at, id)`, which stays fast on large tables.
- A migration helper adds `tenant_id`, its index, and the RLS policy to each new tenant-scoped table, so no table is forgotten.

## Shipment state machine and events

A shipment moves through ten statuses, and only the Shipment aggregate may change them, so every path is explicit and testable.

&#91;embedded content: shipment statuses · 10 states, 13 transitions\]

A shipment can be cancelled only before pickup, and a failed delivery either retries or ends in a return.

**Domain events**

| Event | Raised when | Main consumers |
| --- | --- | --- |
| `ShipmentCreated` | A shipment is saved as CREATED | Audit |
| `ShipmentConfirmed` | CREATED to CONFIRMED | Dispatch, Routing, Notifications, Audit |
| `ShipmentStatusChanged` | Any transition, including assignment, pickup, transit, return, and cancellation | Tracking, Reporting, Dispatch, Audit, WebSocket gateway |
| `ShipmentDelivered` | OUT\_FOR\_DELIVERY to DELIVERED | Notifications, Reporting, Audit |
| `ShipmentFailed` | OUT\_FOR\_DELIVERY to FAILED\_ATTEMPT | Notifications, Reporting, Dispatch |

**Rules enforced in the domain layer**

- Transitions are methods on the aggregate, such as `confirm()`, `assign(driver)`, `markPickedUp()`, and `deliver(proof)`. They check the current status and raise events. Controllers never set a status directly.
- Each transition appends a row to `shipment_status_history` in the same transaction as the change.
- An invalid transition raises a domain error that maps to 409 with the code `SHIPMENT_INVALID_TRANSITION`.
- Confirming requires a valid quote and valid addresses. Delivering requires proof of delivery when the tenant setting demands it. A failed attempt requires a reason code.
- Cancellation is allowed only before pickup.
- After a tenant-configured number of failed attempts, the only way forward is RETURNED.
- The `version` column and the `If-Match` header prevent lost updates when two users act at once.

## Dispatch and driver assignment

Dispatch picks the driver and vehicle for each confirmed shipment. Phase 1 lets dispatchers assign manually with ranked suggestions, and phase 2 adds automatic offers driven by a saga.

**Candidate selection**

1. Eligibility filter: the driver is active and on shift, a vehicle is available with enough weight and volume capacity, and the driver has no conflicting assignment.
2. Proximity search: `ST_DWithin` around the pickup point against each driver's latest location. The radius starts small and widens in steps (for example 5, 10, then 20 km) until candidates are found. The steps are tenant settings.
3. Ranking by an `AssignmentStrategy`, chosen per tenant.
4. Offer to the top candidate, then the next one if the offer is rejected or expires.

| Strategy | Ranks candidates by | Use when |
| --- | --- | --- |
| Nearest driver | Shortest road or straight-line distance to pickup | Fast same-day jobs |
| Least loaded | Fewest active stops today | Balancing work across drivers |
| Balanced | Weighted sum of distance, current load, and capacity fit | Default |

The latest driver position comes from the newest `driver_locations` row in phase 1 and from Redis in phase 2.

**Assignment lifecycle**

| Status | Meaning | Next |
| --- | --- | --- |
| Offered | Driver has been asked and the offer has an expiry | Accepted, rejected, or expired |
| Accepted | Driver took the job | Shipment moves to ASSIGNED, route is replanned |
| Rejected | Driver declined | Next candidate |
| Expired | No answer before the deadline | Next candidate |
| Cancelled | Dispatcher or driver withdrew after acceptance | Shipment returns to CONFIRMED |

**Concurrency guarantees**

- Candidate drivers are claimed with `SELECT ... FOR UPDATE SKIP LOCKED`, so two dispatch runs never offer the same driver at once.
- A partial unique index on `dispatch_assignments (shipment_id)` for active statuses guarantees one live assignment per shipment.
- The shipment's `version` column rejects a stale write from a second dispatcher.

**Dispatch saga (phase 2)**

A process manager reacts to `ShipmentConfirmed`, creates an offer, and schedules a delayed BullMQ job for its expiry. An accept, reject, or timeout event moves it to the next candidate. After a configured number of failed attempts it stops and flags the shipment for manual dispatch. On a driver cancellation after acceptance it releases the driver, returns the shipment to CONFIRMED, and starts again.

**API surface**

- `GET /shipments/:id/dispatch-candidates` returns the ranked list.
- `POST /shipments/:id/assignments` creates a manual assignment.
- `POST /assignments/:id/accept` and `POST /assignments/:id/reject` are called by the driver.

## Route optimization

The optimizer solves a Capacitated Vehicle Routing Problem with Time Windows (CVRPTW): vehicles start and end at the tenant's depot, serve drop-off stops, and must respect capacity, time windows, and shift limits. It is written in plain TypeScript with no framework imports, so it is deterministic and easy to benchmark.

**Problem definition**

| Element | Definition |
| --- | --- |
| Depot | One per tenant in v1, with an opening time |
| Vehicles | Weight and volume capacity, shift start and end, optional maximum route duration |
| Stops | Drop-off location, weight and volume demand, time window (earliest, latest), service time |
| Travel cost | Distance and duration for each pair of locations, from a matrix provider |
| Hard constraints | Vehicle capacity, shift end, and time windows (early arrival waits, late arrival is infeasible) |
| Unserved stops | A stop that cannot be placed is returned in an `unassigned` list with a reason, never an error |

The objective is configurable per tenant:

```latex
\min \; w_d \sum_{r \in R} D_r \;+\; w_v \, |R| \;+\; w_l \sum_{s} \max(0,\, a_s - l_s) \;+\; w_u \, |U|
```

Here D\_r is the distance of route r, R is the set of used routes, a\_s and l\_s are the arrival time and latest time of stop s, and U is the set of unassigned stops. The lateness term only matters in the optional soft-window mode. The weights w\_d, w\_v, w\_l, and w\_u are tenant settings.

**Algorithm pipeline**

1. **Build the input.** Collect confirmed shipments without a route for the plan date, the vehicles on shift, and the depot. Validate coordinates, windows, and capacities.
2. **Get the travel matrix.** A `DistanceMatrixProvider` returns durations and distances. The OSRM adapter calls the `table` API in chunks and caches results by rounded coordinate pair. The Haversine adapter applies a configurable road-circuity factor and average speed. A Euclidean adapter exists for benchmarks.
3. **Construct an initial solution.** Use the Clarke-Wright savings algorithm: for stops i and j the saving is d(depot, i) + d(depot, j) - d(i, j). Route merges are tried in descending order of saving and accepted only if capacity and time windows stay feasible.
4. **Improve with local search.** Intra-route moves are 2-opt and Or-opt (moving segments of one to three stops). Inter-route moves are relocate, swap, and 2-opt\* (exchanging route tails). Feasibility of each move is checked in constant time using forward time slack, so the search stays fast.
5. **Escape local optima.** Simulated annealing accepts some worse moves under a cooling schedule, with periodic restarts from the best known solution. The search stops at the time budget or after a set number of iterations without improvement. A seeded random generator makes runs repeatable.
6. **Post-process.** Compute arrival times, waiting, and ETAs for each stop, plus route metrics and the unassigned list. Persist routes and stops in one transaction and publish `RoutePlanned`.

Adaptive Large Neighborhood Search (ALNS) is the documented upgrade path if you want a stronger metaheuristic later.

**Strategy interface**

```ts
interface RoutingStrategy {
  readonly name: string;
  solve(problem: RoutingProblem, options: SolveOptions): RoutingSolution;
}
// SolveOptions: { timeBudgetMs, seed, weights, maxIterations }
```

| Strategy | Purpose |
| --- | --- |
| `NearestNeighborStrategy` | Baseline for comparison |
| `SavingsStrategy` | Clarke-Wright construction only |
| `SavingsLocalSearchStrategy` | Construction plus local search, deterministic and fast |
| `AnnealingStrategy` | Default. Construction, local search, and annealing within the time budget |

**Execution model**

- Optimization is CPU-bound, so it runs in a `worker_threads` pool (Piscina) and never on the HTTP event loop.
- Phase 1: the pool lives inside the API process. Phase 2: it lives in the worker and is fed by the `routing` queue.
- `POST /routes/plan` returns 202 with a status URL, and the result is pushed through the `route:updated` event.
- The number of stops per run is capped by the tenant's plan limit, and every job has a hard timeout.

**Re-optimization**

- A new urgent shipment is placed with cheapest insertion: try every feasible position in every route and take the lowest added cost. This is fast and runs inline.
- A driver who deviates or is delayed triggers a replan of the remaining stops, using the driver's current position as the start.
- A cancelled shipment removes its stop, and a short local search tidies the affected route.
- A full background re-plan can run afterward, and its result replaces the live plan only if it is better.

**Validation and benchmarking**

- Fixtures include Solomon VRPTW instances (such as C101, R101, and RC101) and CVRPLIB capacitated instances (such as A-n32-k5).
- A benchmark script reports total distance, vehicle count, runtime, the gap to the best known solution, and the improvement over nearest-neighbor. The results table goes in the README once measured.
- Property tests assert that every solution is feasible, visits each stop exactly once or lists it as unassigned, and is identical for the same seed.

## Live tracking and real time

Drivers push locations in batches, the latest position is kept hot for reads, and history is written in bulk to protect the free database. Socket.IO rooms deliver updates to dispatchers and customers.

**Location ingest**

- Drivers send points through `POST /tracking/locations` or the WebSocket event `location:update`. Both accept an array, so a driver who was offline can upload buffered points.
- Each point is validated for range, timestamp, and driver identity. Points older than a configured age or implausibly far from the previous one are discarded.
- The latest position per driver is held in Redis under a TTL key in phase 2, and read from the newest `driver_locations` row in phase 1.
- History is buffered and flushed in batches by count or time. Points closer than a minimum distance or interval to the previous one are skipped.
- A retention job deletes history older than a tenant-configurable number of days.

**Socket.IO design**

- The JWT is verified in the handshake, and the connection carries the tenant ID.
- Rooms are `tenant:{id}`, `driver:{id}`, `shipment:{id}`, and `route:{id}`. Joining a room requires the permission and the same tenant.
- Phase 2 adds the Redis adapter so more than one API instance can broadcast to the same rooms.

| Event | Direction | Room | Payload |
| --- | --- | --- | --- |
| `location:update` | Driver to server | none | Array of points |
| `driver:location` | Server to clients | `tenant`, `shipment` | Driver ID, position, speed, time |
| `shipment:status` | Server to clients | `tenant`, `shipment` | Shipment ID, new status, time |
| `route:updated` | Server to clients | `tenant`, `route` | Route ID, stop order, ETAs |
| `offer:new` | Server to driver | `driver` | Assignment ID, pickup, drop-off, expiry |

**ETA and geofencing**

- ETA for each remaining stop comes from the latest position, the route's stop order, and the distance matrix provider. It is recalculated on location updates, at most once per minute per route.
- A geofence check with `ST_DWithin` raises `DriverNearDestination` when the driver comes within a configured radius of the drop-off. Notifications can turn that into an "arriving soon" email, which is off by default to save Gmail quota.

**Public tracking**

`GET /public/tracking/:trackingNumber` requires a random public token and returns the status timeline and ETA. It shows the driver's position only while the shipment is out for delivery, and it is rate limited per IP.

## Notifications and email

Email goes through an `EmailPort` with a Gmail SMTP adapter, a daily quota guard, and a deduplication key so retries never send twice. In-app updates are Socket.IO pushes and are not stored.

**Adapters**

| Adapter | Used in | Behavior |
| --- | --- | --- |
| `GmailSmtpAdapter` | Staging and demo | Nodemailer over `smtp.gmail.com`, port 465 (TLS), authenticated with an App Password |
| `ConsoleEmailAdapter` | Local development | Logs the rendered message |
| `InMemoryEmailAdapter` | Tests | Collects messages for assertions |

**Gmail SMTP setup**

- Turn on 2-Step Verification for the Gmail account, then create an App Password for the app.
- Store the address and App Password only in environment variables or the host's secret store, and document how to rotate them.
- Use a small connection pool and a send rate limit so a burst does not trigger Gmail throttling.
- Gmail rewrites the sender to the authenticated account. Each message therefore uses the tenant's name as the display name and the tenant's contact address in `Reply-To`.

**Quota guard**

- A personal Gmail account allows roughly 500 messages a day. The global limit is configurable and set below that with headroom.
- Each tenant gets a daily share, counted from `email_log` in phase 1 and from a Redis counter in phase 2.
- Messages are tagged critical or normal. When a quota is nearly used, normal messages are skipped and logged, and critical messages still send.

**Templates**

| Template | Trigger | Recipient | Priority |
| --- | --- | --- | --- |
| `invite-user` | UserInvited | Invitee | Critical |
| `verify-email` | UserRegistered | New user | Critical |
| `reset-password` | Password reset requested | User | Critical |
| `shipment-confirmed` | ShipmentConfirmed | Customer | Normal |
| `driver-assigned` | DriverAssigned | Customer | Normal |
| `out-for-delivery` | Status changed to OUT\_FOR\_DELIVERY | Customer | Normal |
| `delivered-receipt` | ShipmentDelivered | Customer | Critical |
| `failed-attempt` | ShipmentFailed | Customer | Critical |
| `arriving-soon` | DriverNearDestination | Customer | Normal, off by default |

Templates are Handlebars files in the repository, rendered with tenant branding values such as name, logo URL, and accent color. Every message also includes a plain-text part, which helps deliverability from a personal Gmail sender.

**Delivery and retries**

- Phase 1: an event handler renders and sends the message in process, catches errors, and records the result in `email_log`.
- Phase 2: the handler enqueues a job on the BullMQ `email` queue. The worker retries with exponential backoff, moves exhausted jobs to a dead-letter queue, and updates `email_log`.
- A deduplication key built from the event ID, template, and recipient is unique in `email_log`, so a replayed event never produces a second email.

## Eventing and async processing

Phase 1 uses an in-process event bus. Phase 2 puts a transactional outbox behind the same event-bus port, so no domain code changes. The zero-spend build embeds the relay in the API process; Redis, BullMQ, and the separate worker are the intended scale-up, described under **Queues** and **Worker process** below.

**Event envelope**

Every event carries `id`, `type`, `tenantId`, `occurredAt`, `aggregateType`, `aggregateId`, `aggregateVersion`, `correlationId`, `causationId`, and `payload`. The correlation ID follows a request through all downstream events and log lines.

| Aspect | Phase 1 | Phase 2 (as built) |
| --- | --- | --- |
| Event bus | `@nestjs/event-emitter`, in process | `OutboxEventBus`: append to `outbox_messages`, then dispatch |
| Delivery guarantee | Best effort, lost if the process crashes | At least once, retried with backoff |
| Retry driver | None | Embedded `OutboxRelayService` (`FOR UPDATE SKIP LOCKED`) |
| Consumers | Listeners inside the API process | The same listeners |
| Email | Sent in process | Sent in process, deduplicated by `email_log.dedupe_key` |
| Route optimization | Thread pool inside the API process | Floating in-process task (queue in the worker later) |
| Idempotency | Not needed | Delivery and the `processed` flag commit atomically; side effects carry their own dedupe keys |

**Outbox pattern (as built)**

1. A command handler changes the aggregate; the `OutboxEventBus` adapter inserts the envelope into `outbox_messages` in the same database transaction, so the event exists if and only if the change commits.
2. The same adapter dispatches the event in-process (the phase-1 fast path) and marks the row `processed`. A listener that throws records the attempt and leaves the row `pending`, without failing the request.
3. `OutboxRelayService`, embedded in the API process, claims `pending` rows with `FOR UPDATE SKIP LOCKED` every `OUTBOX_RELAY_INTERVAL_MS`, redelivers them, and retries with exponential backoff up to `OUTBOX_MAX_ATTEMPTS`.
4. Delivery and the `processed` flag share one transaction (tenant rows open a tenant transaction so listeners keep their RLS context), so a crash rolls back both and a redelivery starts from a clean slate. `event_id` is unique, so a replayed command is a no-op at the append.

A separate consumer-dedupe table (`processed_events`) is not needed in this embedded design because the side effects, the row status, and the marker would commit atomically anyway. The BullMQ/worker variant adds one, since there the delivery and the acknowledgement are separate transactions and a worker can die between them.

**Queues**

Not in the zero-spend build: Redis and BullMQ are the scale-up, and the outbox relay already carries their shape. The table below is the target, not what runs today.

| Queue | Producer | Processor | Settings |
| --- | --- | --- | --- |
| `events` | Outbox relay | Projections, audit writer, notification triggers, dispatch saga | At-least-once, retries with backoff |
| `email` | Notifications | Email sender | Five attempts, exponential backoff, dead-letter queue, rate limit to protect Gmail |
| `routing` | Routing and Dispatch | Route optimizer in a worker-thread pool | Low concurrency, job timeout equal to the time budget plus a margin |
| `maintenance` | Repeatable cron jobs | Retention, expired-offer cleanup, token and idempotency-key cleanup | Runs on a schedule |

Failed jobs end in a dead-letter queue. A Bull Board dashboard, restricted to platform admins, lets you inspect and replay them.

**Worker process**

- `worker.ts` calls `NestFactory.createApplicationContext(WorkerModule)`. It has no HTTP listener beyond a small health endpoint.
- It shuts down gracefully on `SIGTERM`: it stops taking jobs and drains the ones in progress.
- Every job payload carries `tenantId`, and the processor opens a tenant-scoped transaction before touching data.
- Some free hosts include only one free service. An `EMBEDDED_WORKER=true` setting runs the processors inside the API process, so the project still deploys on a single free instance.

## API design

The API is a versioned REST interface under `/api/v1`, documented with OpenAPI, with consistent conventions for errors, pagination, idempotency, and concurrency.

**Conventions**

| Topic | Decision |
| --- | --- |
| Versioning | URL prefix `/api/v1`. A new version is added only for breaking changes. |
| Authentication | `Authorization: Bearer <access token>` |
| Errors | `application/problem+json` (RFC 9457) with `type`, `title`, `status`, `detail`, `instance`, a stable `code`, field `errors`, and `correlationId` |
| Pagination | Cursor based: `?limit=` and `?cursor=`, returning `data` and `nextCursor` |
| Filtering and sorting | Whitelisted fields per resource, validated in DTOs |
| Idempotency | `Idempotency-Key` header on creating endpoints. Same key and same body returns the stored response. Same key and different body returns 409. |
| Concurrency | Updates send `If-Match` with the resource version. A mismatch returns 412. |
| Long operations | Return 202 with a status URL. Route planning is the main case. |
| Rate limiting | `@nestjs/throttler` per IP and per tenant, with `429` and `Retry-After` |
| Validation | Global validation pipe that strips unknown fields |

State changes that are business actions use action endpoints such as `POST /shipments/:id/confirm`, so each one maps to one command and one state-machine transition.

**Endpoint groups**

| Area | Main endpoints |
| --- | --- |
| Authentication | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/switch-tenant`, `/auth/accept-invite`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email` |
| Platform | `POST /platform/tenants`, `GET /platform/tenants`, `PATCH /platform/tenants/:id` |
| Users | `GET /users`, `POST /users/invitations`, `PATCH /memberships/:id` |
| Customers | `/customers` CRUD, `/customers/:id/addresses` |
| Fleet and drivers | `/vehicles` CRUD, `/drivers` CRUD, `/drivers/:id/shifts`, `PATCH /drivers/me/availability` |
| Pricing | `/pricing-rules` CRUD, `POST /quotes` |
| Shipments | `POST /shipments`, `GET /shipments`, `GET /shipments/:id`, `POST /shipments/:id/confirm`, `/cancel`, `/pickup`, `/start-delivery`, `/deliver`, `/fail` |
| Dispatch | `GET /shipments/:id/dispatch-candidates`, `POST /shipments/:id/assignments`, `POST /assignments/:id/accept`, `/reject` |
| Routing | `POST /routes/plan`, `GET /routes`, `GET /routes/:id`, `POST /routes/:id/replan`, POST /routes/:id/start |
| Tracking | `POST /tracking/locations`, `GET /drivers/:id/location`, `GET /shipments/:id/track`, `GET /public/tracking/:trackingNumber` |
| Proof of delivery | `POST /shipments/:id/proof`, `POST /shipments/:id/otp/verify` |
| Reports | `GET /reports/delivery-performance`, `/reports/driver-performance`, `/reports/fleet-utilization` |
| Operations | `GET /health`, `GET /metrics` |

**Example: error response**

```json
{
  "type": "https://api.example.com/problems/invalid-transition",
  "title": "Invalid shipment transition",
  "status": 409,
  "detail": "A shipment in status DELIVERED cannot be cancelled.",
  "instance": "/api/v1/shipments/3f2a.../cancel",
  "code": "SHIPMENT_INVALID_TRANSITION",
  "correlationId": "b1c6d1f0-5a2e-4c89-9b0d-1f7e2a6c4d11"
}
```

## Cross-cutting concerns

Security, observability, and reliability are handled once, in shared infrastructure, and apply to every module.

| Concern | Approach |
| --- | --- |
| Security headers and CORS | Helmet, with an explicit CORS allow-list per environment |
| Secrets | Environment variables validated at startup with a schema, so the app refuses to boot with missing or malformed config |
| Password and token security | Argon2 hashing, hashed refresh and one-time tokens, short access-token lifetime |
| Input handling | Global validation pipe with whitelisting, request size limits, parameterized queries only, upload type and size checks |
| Error handling | One global exception filter maps domain, validation, and unexpected errors to problem details. Internals are never leaked. |
| Logging | `nestjs-pino` JSON logs with request ID, correlation ID, tenant ID, and user ID. Sensitive fields are redacted. |
| Metrics | Prometheus `/metrics`: request rate and latency, queue depth, job failures, route-optimizer duration, email results, WebSocket connections |
| Health | `/health/live` and `/health/ready`, using Terminus checks for Postgres, Redis, and queue connectivity |
| Tracing | Correlation ID propagated through events and jobs. OpenTelemetry can be added later. |
| Audit | An audit subscriber writes every domain event and admin action to `audit_logs`, including actor, tenant, and a field-level diff |
| Configuration | Typed `@nestjs/config` modules per area, with one `.env.example` |
| Graceful shutdown | Shutdown hooks drain HTTP connections, WebSocket clients, and queue jobs |
| Time handling | All timestamps stored in UTC. Tenants have a time zone setting used for scheduling and reports. |
| Resilience | Timeouts and circuit breaking on OSRM and Nominatim calls, with Haversine and cached fallbacks |

**Suggested free monitoring**

- Grafana Cloud free tier can scrape or receive the Prometheus metrics and show a dashboard.
- Sentry's free plan can capture unhandled exceptions.
- A screenshot of the dashboard in the README is worth including.

## Testing strategy

Tests follow the architecture: fast unit tests on pure domain code, integration tests against a real Postgres, and end-to-end tests on the main flows.

| Level | Scope | Tools | Examples |
| --- | --- | --- | --- |
| Unit | Domain and application logic, no I/O | Jest | State machine transitions, pricing rules, assignment ranking, route-optimizer operators |
| Integration | Repositories, migrations, RLS, outbox, queues | Jest, Testcontainers (Postgres with PostGIS, Redis) | Tenant isolation, optimistic locking, `SKIP LOCKED` claiming, spatial queries, outbox relay |
| End to end | HTTP and WebSocket flows across modules | Supertest, `socket.io-client` | Quote to delivery, driver offer and accept, public tracking |
| Contract | API shape and error format | OpenAPI snapshot check | Fails CI when an endpoint changes unintentionally |
| Performance | Route optimizer and ingest path | Benchmark script, k6 optional | Solution quality and runtime on benchmark instances |

**Tests that carry the portfolio claims**

- **Tenant isolation:** seed two tenants, run an unfiltered query under tenant A, and assert that no tenant B row is returned. Repeat for every tenant-scoped table by iterating over the schema.
- **State machine:** a table-driven test covers every status pair, with allowed and forbidden transitions listed explicitly.
- **Concurrency:** two simultaneous assignments of one shipment must produce exactly one active assignment.
- **Outbox:** kill the relay between insert and publish, restart it, and assert that the event is delivered once.
- **Routing quality:** run the optimizer on fixed benchmark instances with a fixed random seed, and assert it never exceeds the nearest-neighbor distance and stays under a stated gap to the best known solution.
- **Email:** the in-memory adapter asserts the right template, recipient, and dedupe behavior. No test ever calls Gmail.

**Practices**

- Test data builders and a seeder produce realistic tenants, drivers, and shipments.
- CI runs lint, type check, unit tests, and integration tests on every push, and reports coverage.
- External services (OSRM, Nominatim, storage) are faked behind their ports.

## CI/CD and deployment

GitHub Actions builds and tests every change, and a tagged build deploys to a free host. Local development needs only Docker.

**Environments**

| Environment | Runs on | Services | Email |
| --- | --- | --- | --- |
| Local | Docker Compose | API, worker, Postgres with PostGIS, Redis, optional Mailpit | Console adapter or Mailpit |
| CI | GitHub Actions runners | Testcontainers for Postgres and Redis | In-memory adapter |
| Demo | Free host | API and worker, Neon or Supabase Postgres, Upstash Redis | Gmail SMTP |

**Pipeline**

1. Pull request: install, lint, type check, unit tests, integration tests, OpenAPI snapshot check, and a build of the Docker image.
2. Main branch: the same steps, then publish the image to GitHub Container Registry, which is free for public repositories.
3. Release tag: run migrations as `ldms_owner`, then deploy the image to the demo host.
4. After deploy: a smoke test calls `/health/ready` and a read-only API route.

**Deployment notes**

- One Docker image serves both processes. The command decides whether it starts `main.js` or `worker.js`.
- Migrations run as a separate release step, never at API startup, because the runtime role cannot change the schema.
- If the host offers only one free service, set `EMBEDDED_WORKER=true` so the API process also runs the queue processors.
- Free hosts may stop idle services. The README should state the cold-start time and offer a seeded demo tenant with sample credentials.
- Enable the PostGIS extension in the hosted database before the first migration.

**Repository hygiene**

- Conventional commits, a pull request template, and branch protection on main.
- Dependabot or Renovate for dependency updates.
- `.env.example`, a `Makefile` or npm scripts for common tasks, and a seed command for demo data.

## Phased roadmap

The build runs in three phases, and each ends at a gate that must pass before the next one begins.

&#91;embedded content: roadmap · 3 phases, 3 gates\]

**Build order**

1. Scaffold the repository: config, Docker Compose, CI, logging, error format, and Swagger. (phase 1)
2. Tenants, identity, memberships, RBAC, and RLS with isolation tests. (phase 1)
3. Customers, fleet, and drivers. (phase 1)
4. Pricing and shipments with the state machine. (phase 1)
5. In-process events, notifications, and the Gmail adapter. (phase 1)
6. Dispatch: manual assignment first, then PostGIS suggestions. (phase 1)
7. Routing: matrix providers, savings construction, local search, annealing, and benchmarks. (phase 1)
8. Tracking over WebSockets and proof of delivery. (phase 1)
9. Redis, BullMQ, and the worker entrypoint. (phase 2, deferred in the zero-spend build)
10. Outbox pattern with an embedded relay. (done — processed-event tracking is folded into the delivery transaction)
11. Move email, routing, and event handling onto queues, with retries and a dead-letter queue. (phase 2, deferred)
12. Dispatch saga with offer timeouts and reassignment. (phase 2)
13. Reporting read models, audit polish, metrics, health checks, and dashboards. (phase 3)
14. ADRs, diagrams, seed data, a README with benchmark results, and the demo deployment. (phase 3)

Phase 1 alone is a complete, demonstrable project. Phases 2 and 3 are what take it from solid to advanced.

## ADRs, risks, and open questions

Each decision below becomes a short Architecture Decision Record in `docs/adr`. Items you chose explicitly are marked accepted, and the rest are proposed for your review.

**ADR index**

| ADR | Decision | Status |
| --- | --- | --- |
| 001 | Modular monolith with domain events instead of microservices | Proposed |
| 002 | Shared-schema multi-tenancy with `tenant_id` and Postgres RLS | Proposed |
| 003 | TypeORM with migrations only and persistence entities mapped to domain entities | Accepted (TypeORM), mapping proposed |
| 004 | Gmail SMTP with an App Password behind an `EmailPort` | Accepted |
| 005 | In-process events in phase 1, outbox plus BullMQ in phase 2 | Proposed |
| 006 | Separate worker process added after the core CRUD works | Accepted |
| 007 | Custom route optimizer: savings construction, local search, metaheuristic | Accepted |
| 008 | OSRM or OpenRouteService with Haversine fallback instead of Google Maps | Proposed |
| 009 | Refresh-token rotation with reuse detection | Proposed |
| 010 | Collapsed layers for simple CRUD modules | Proposed |

**Risks and mitigations**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Gmail daily limit reached or account flagged | Emails stop | Quota guard, critical-first priority, low demo volume, console adapter fallback |
| Free database limits on storage and connections | Outages or write failures | Batched location writes, retention job, small connection pool |
| Public OSRM or Nominatim is slow, limited, or down | Route planning fails | Caching, Haversine fallback, optional local OSRM in Docker |
| RLS misconfigured on a new table | Cross-tenant data leak | Migration helper, non-owner runtime role, isolation test over every table |
| Optimizer uses too much CPU on a small host | Timeouts, blocked requests | Worker threads, time budget, job timeout, cap on stops per run |
| Free host cold starts | Slow first request | Document it, provide a seeded demo tenant |
| Layering overhead slows delivery | Project stalls | Collapse layers for simple modules, build in phases with gates |
| Scope creep | Project never finishes | Non-goals list and phase gates |

**Open questions**

- **Route model:** should v1 plan depot-based delivery routes (CVRPTW), with pickup-and-delivery pairing (PDPTW) as a later extension? This document assumes yes.
- **Customer access:** do customers log in to create shipments, or only receive tracking links? The role table currently allows both.
- **Demo host:** Render, Fly.io, or an Oracle Cloud Always Free VM?
- **Depot model:** one depot per tenant, or several? This document assumes one in v1.
