# Routiq Bots

Automated API consumers that use the Routiq API exactly the way a real
logistics integrator would — over HTTP, with JWT auth, `If-Match` concurrency
control and `application/problem+json` errors. No database shortcuts.

They give the API something to do: every run books a real shipment, dispatches
it, streams GPS from a driver, captures proof of delivery and completes the
delivery.

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
```

## What each bot does

| Bot | Identity | Actions |
| --- | --- | --- |
| **CompanyAgent** | tenant admin | quotes a lane, books a shipment, confirms it |
| **DispatcherAgent** | dispatcher | lists confirmed shipments, reads dispatch candidates, offers the job to the closest driver |
| **DriverAgent** | driver | goes on shift, accepts the offer, advances the shipment `PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY`, streams GPS, captures photo proof, delivers |

## Configuration

All settings have defaults; override with environment variables (see
`.env.example`) or CLI flags.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROUTIQ_API_URL` | manifest / `http://localhost:3000/api/v1` | API base URL |
| `ROUTIQ_SEED_MANIFEST` | `../api/.demo-seed.json` | Seeded companies/drivers |
| `ROUTIQ_DEMO_PASSWORD` | `Passw0rd!demo` | Shared demo password |
| `ROUTIQ_BOT_ROUNDS` | `1` | Rounds to run (`0` = infinite) |
| `ROUTIQ_BOT_INTERVAL_SECONDS` | `15` | Pause between rounds |

## Pointing at a deployed API

```bash
ROUTIQ_API_URL=https://routiq-logistics-and-delivery.onrender.com/api/v1 \
ROUTIQ_SEED_MANIFEST=../api/.demo-seed.json \
pnpm simulate
```

The seeded accounts must exist in that environment (run the seed against it,
or create the tenants via the platform-admin API and adjust the manifest).
