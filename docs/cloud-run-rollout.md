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
2. For production, target the canonical gateway service in `mitch-ai-services / europe-west2 / ai-gateway`.
3. Resolve the verification URL from Cloud Run before smoke tests:

```bash
gcloud run services describe ai-gateway \
  --project mitch-ai-services \
  --region europe-west2 \
  --format='value(status.url)'
```

4. Set `MAX_CONCURRENT_REQUESTS` and a minimal `TENANT_POLICIES_JSON` for known tenants.
5. Verify authenticated `/ready` returns `200` and includes at least one `ready: true` provider.
6. Confirm logs contain stable `error.code` values for rejected traffic.
7. Watch Cloud Run request latency, 5xx rate, and saturation during peak traffic.
8. After clients consistently send tenant identity, switch `REQUIRE_TENANT_ID=true`.

## Pre-Deploy Checks

- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- Confirm `GATEWAY_MASTER_KEY` and provider keys are sourced from Secret Manager or equivalent secure env injection.
- Confirm deployment or traffic-gating checks use authenticated `GET /ready`. Keep container health checks on `GET /health`.
- Pin every `gcloud run` command to the intended `--project` and `--region`; do not rely on CLI defaults.
- Use the Cloud Run `status.url` value as the canonical gateway URL. Do not assume a regional `ai-gateway-<project-number>.<region>.run.app` alias is current.

## Smoke Checks After Deploy

- `GET /health` returns `200`
- Authenticated `GET /ready` returns `200`
- Authenticated `GET /ready` shows `master_key_configured: true`
- Authenticated `GET /ready` shows realistic `inflight` counts
- Authenticated `GET /providers` returns tenant-filtered providers when `x-tenant-id` is present
- Invalid provider/model requests return stable `error.code` values

## Suggested Alerts

- Alert on repeated `error.code="concurrency.global_limit_reached"`
- Alert on repeated `error.code="ai.completion_failed"`
- Alert when `/ready` returns `503`
- Alert when all enabled providers report `ready: false`
- For baseline Cloud Monitoring alert policies, run [`scripts/configure-cloud-monitoring-alerts.sh`](/home/godja/Dev/ai-gateway/scripts/configure-cloud-monitoring-alerts.sh) and follow [`docs/cloud-monitoring-alerts.md`](/home/godja/Dev/ai-gateway/docs/cloud-monitoring-alerts.md).

## Rollback Trigger

Rollback if any of the following appear immediately after deploy:

- sustained increase in `503` from `/ready`
- large spike in `concurrency.global_limit_reached`
- client failures caused by missing tenant IDs after enabling `REQUIRE_TENANT_ID=true`
- unexpected routing or tenant policy rejections for valid traffic

## Rollback Procedure

See [docs/INCIDENT-RESPONSE.md](/home/godja/Dev/ai-gateway/docs/INCIDENT-RESPONSE.md) for full details.

1. Identify stable revision: `gcloud run revisions list --service ai-gateway --region europe-west2 --limit 5`
2. Shift traffic: `gcloud run services update-traffic ai-gateway --to-revisions=STABLE_REVISION_ID=100 --region europe-west2`
