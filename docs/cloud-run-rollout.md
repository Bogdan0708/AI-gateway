# Cloud Run Rollout Checklist

Use this checklist when promoting the hardened gateway configuration to production on GCP Cloud Run.

## Recommended Starting Values

Start conservatively, then raise limits from observed traffic:

- `MAX_CONCURRENT_REQUESTS=20`
- `REQUIRE_TENANT_ID=false`
- `LOG_LEVEL=info`
- `TENANT_POLICIES_JSON` with per-tenant `maxConcurrentRequests` between `3` and `10`
- `TENANT_POLICIES_JSON` with per-tenant `maxTokens` aligned to the cheapest acceptable model for that tenant

If Cloud Run container concurrency is set above `20`, keep `MAX_CONCURRENT_REQUESTS` lower until you have stable latency and upstream provider data.

## Rollout Order

1. Deploy the current code with `/ready` enabled and `REQUIRE_TENANT_ID=false`.
2. Set `MAX_CONCURRENT_REQUESTS` and a minimal `TENANT_POLICIES_JSON` for known tenants.
3. Verify `/ready` returns `200` and includes at least one `ready: true` provider.
4. Confirm logs contain stable `error.code` values for rejected traffic.
5. Watch Cloud Run request latency, 5xx rate, and saturation during peak traffic.
6. After clients consistently send tenant identity, switch `REQUIRE_TENANT_ID=true`.

## Pre-Deploy Checks

- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- Confirm `GATEWAY_MASTER_KEY` and provider keys are sourced from Secret Manager or equivalent secure env injection.
- Confirm the deployed container health check or external monitor uses `GET /ready`, not `GET /health`.

## Smoke Checks After Deploy

- `GET /health` returns `200`
- `GET /ready` returns `200`
- `GET /ready` shows `master_key_configured: true`
- `GET /ready` shows realistic `inflight` counts
- Authenticated `GET /providers` returns tenant-filtered providers when `x-tenant-id` is present
- Invalid provider/model requests return stable `error.code` values

## Suggested Alerts

- Alert on repeated `error.code="concurrency.global_limit_reached"`
- Alert on repeated `error.code="ai.completion_failed"`
- Alert when `/ready` returns `503`
- Alert when all enabled providers report `ready: false`

## Rollback Trigger

Rollback if any of the following appear immediately after deploy:

- sustained increase in `503` from `/ready`
- large spike in `concurrency.global_limit_reached`
- client failures caused by missing tenant IDs after enabling `REQUIRE_TENANT_ID=true`
- unexpected routing or tenant policy rejections for valid traffic
