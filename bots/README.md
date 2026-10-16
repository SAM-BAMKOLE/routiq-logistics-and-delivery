# Routiq Bots

Automated API consumers that use the Routiq API exactly the way a real
logistics integrator would — over HTTP, with JWT auth, `If-Match` concurrency
control and `application/problem+json` errors. No database shortcuts.

They give the API something to do: every run books a real shipment, dispatches
it, streams GPS from a driver, captures proof of delivery and completes the
delivery — or, a fraction of the time, records a failed attempt and closes the
shipment out as returned, so the failure paths are exercised too.

## Prerequisites

1. The API is running (`pnpm start:dev` in `../api`).
2. Demo data is seeded (`pnpm db:seed:demo` in `../api`), which writes
   `../api/.demo-seed.json`.

## Run

```bash
pnpm install
pnpm simulate                     # one shipment lifecycle per demo company
pnpm simulate --rounds 5          # five rounds, 15s apart
pnpm simulate --companies acme-logistics
pnpm simulate --rounds 0          # loop until Ctrl+C
pnpm simulate --parallel          # run companies concurrently
pnpm simulate --failure-rate 0    # all-green run (no failed attempts)
pnpm simulate --return-rate 0.5   # half of shipments end RETURNED
pnpm simulate --rotation-offset 1 # pin which driver is on shift (tests)
```

## What each bot does

| Bot | Identity | Actions |
| --- | --- | --- |
| **CompanyAgent** | tenant admin | quotes a lane, books a shipment, confirms it |
| **DispatcherAgent** | dispatcher | lists confirmed shipments, reads dispatch candidates, offers the job to the closest driver, closes a failed shipment as RETURNED |
| **DriverAgent** | driver | goes on shift, accepts the offer, advances the shipment `PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY`, streams GPS, captures photo proof, delivers — or records a failed attempt |

### Driver rotation

Each round puts exactly one of a company's drivers on shift (the rest are set
`unavailable`) and rotates by round. The starting driver advances with the
clock — one step per `ROUTIQ_BOT_ROTATION_WINDOW_MINUTES` (default 30 min) — so
even a single-round scheduled tick keeps spreading work across the fleet.
Without this, every seeded driver ties on distance (no GPS yet) and dispatch
hands every shipment to the same lowest-id driver, leaving the others empty.

### Failure simulation

`ROUTIQ_BOT_FAILURE_RATE` (default `0.25`) is the chance a shipment hits a
failed attempt at out-for-delivery. Most failures then retry and deliver;
`ROUTIQ_BOT_RETURN_RATE` (default `0.1`) is the slice that the dispatcher
closes out as `RETURNED`. A failed attempt raises a `ShipmentFailed` event, so
the customer gets a critical "failed attempt" email. Set both to `0` for an
all-green run.

## Configuration

All settings have defaults; override with environment variables (see
`.env.example`) or CLI flags.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROUTIQ_API_URL` | manifest / `http://localhost:3000/api/v1` | API base URL |
| `ROUTIQ_SEED_MANIFEST` | `../api/.demo-seed.json` | Seeded companies/drivers (path) |
| `ROUTIQ_SEED_MANIFEST_JSON` | — | Same manifest as inline JSON (takes precedence; handy in CI) |
| `ROUTIQ_DEMO_PASSWORD` | `Passw0rd!demo` | Shared demo password |
| `ROUTIQ_BOT_ROUNDS` | `1` | Rounds to run (`0` = infinite) |
| `ROUTIQ_BOT_INTERVAL_SECONDS` | `15` | Pause between rounds |
| `ROUTIQ_BOT_FAILURE_RATE` | `0.25` | Chance a shipment hits a failed attempt |
| `ROUTIQ_BOT_RETURN_RATE` | `0.1` | Chance a shipment ends RETURNED |
| `ROUTIQ_BOT_ROTATION_WINDOW_MINUTES` | `30` | Minutes per driver-rotation step |
| `ROUTIQ_BOT_ROTATION_OFFSET` | clock-derived | Pin the rotation slot |
| `ROUTIQ_BOT_WARMUP_SECONDS` | `300` | How long to wait for a sleeping host to boot before giving up |
| `ROUTIQ_BOT_HTTP_RETRIES` | `6` | Attempts per request on transient failures |
| `ROUTIQ_BOT_HTTP_TIMEOUT_MS` | `30000` | Per-attempt request timeout |

## Surviving a sleeping host

A free-tier API spins down when idle. That is not an error to the bots:

- **Before a run**, `waitForApi` polls `/health/live` for up to
  `ROUTIQ_BOT_WARMUP_SECONDS`, treating the first failed probes as the host
  booting rather than a failure to start.
- **During a run**, every request retries transient failures (network errors,
  `429`, `502`, `503`, `504`) with exponential backoff, honouring `Retry-After`.
  A cold start mid-run therefore recovers on its own.
- **A failed round never stops the loop.** `runCompanyScenario` catches errors
  and records them; the next round runs regardless. Only exhausting the warm-up
  budget exits non-zero, so an external scheduler retries later.

## Running continuously

A bot run is an ordinary process, so "continuous" means somewhere keeps it
running. On GitHub Actions, `.github/workflows/simulate-bots.yml` runs the fleet
on a schedule (every 30 minutes) plus on demand, configured with a
`ROUTIQ_API_URL` variable and the manifest/password as secrets. Each tick is
independent, and a sleeping host is handled by the warm-up above.

> Note: GitHub's `schedule` trigger is best-effort and only runs on the default
> branch. It can be delayed, skipped under load, and is auto-disabled after 60
> days without repository activity. Do not rely on it as a keep-alive; for a
> genuinely always-on loop, run `pnpm simulate --rounds 0` on an always-on host
> (e.g. an Oracle Cloud Always Free VM) under systemd or pm2.


## Pointing at a deployed API

```bash
ROUTIQ_API_URL=https://routiq.example.com/api/v1 \
ROUTIQ_SEED_MANIFEST=../api/.demo-seed.json \
pnpm simulate
```

The seeded accounts must exist in that environment (run the seed against it,
or create the tenants via the platform-admin API and adjust the manifest).
