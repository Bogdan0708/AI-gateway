# Rate Limit Load Test

Use this script to validate that the gateway rate limiter rejects excess traffic with `HTTP 429`.

Script path:

- `scripts/rate-limit-load-test.mjs`

## What it does

It runs two phases against one tenant key:

- `pre-limit` phase: low volume that should stay below the configured limit
- `burst` phase: high volume expected to exceed the limit and trigger `429`

The script exits non-zero when validation fails.

## Prerequisites

- Gateway running and reachable
- Valid `GATEWAY_MASTER_KEY` (passed as `AUTH_TOKEN`)
- Endpoint under auth + rate limiting (default: `GET /providers`)

## Run

```bash
AUTH_TOKEN="your-master-key" \
BASE_URL="http://localhost:8080" \
PRE_TOTAL=20 \
PRE_CONCURRENCY=5 \
BURST_TOTAL=120 \
BURST_CONCURRENCY=30 \
npm run loadtest:rate-limit
```

## Optional settings

- `ENDPOINT` (default `/providers`)
- `TENANT_ID` (default auto-generated)
- `REQUEST_TIMEOUT_MS` (default `15000`)
- `EXPECT_429` (default `true`; set `false` for exploratory runs)
