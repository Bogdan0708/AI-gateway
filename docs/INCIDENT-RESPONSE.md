# AI Gateway — Incident Response Runbooks

This document provides step-by-step procedures for responding to common operational incidents with the AI Gateway.

---

## 1. Provider Outage (Upstream Failure)

**Symptoms:**
- Error code: `ai.completion_failed`
- High 5xx rate in Cloud Monitoring for specific providers
- Status `ready: false` for providers in authenticated `GET /ready`
- Increased fallback frequency in logs (`ai_gateway_fallback_total` metric)

**Actions:**
1. **Verify Outage:**
   - Check official status pages:
     - [OpenAI Status](https://status.openai.com/)
     - [Anthropic Status](https://status.anthropic.com/)
     - [Google Cloud Status](https://status.cloud.google.com/) (for Gemini)
     - [Groq Status](https://status.groq.com/)
   - Check AI Gateway logs for specific error messages from the provider SDK.
2. **Short-Term Mitigation:**
   - If the outage is partial or model-specific, the gateway's internal fallback chain should handle it automatically.
   - If the outage is global for a provider, disable it by removing its API key from the environment or setting `routingProviderDisabled` in the tenant policy.
3. **Tenant Policy Adjustment:**
   - If a tenant is pinned to a failing provider, update `TENANT_POLICIES_JSON` to allow an alternative provider.
   - Example: Change `allowedProviders: ["openai"]` to `allowedProviders: ["openai", "claude"]`.
4. **Communication:**
   - Notify affected consumers (e.g., Taxes, EU-Funds teams) via the `#ai-gateway-ops` channel.

---

## 2. Upstream Rate Limiting (429)

**Symptoms:**
- Error code: `ai.completion_failed` with `429` status from provider
- Error code: `routing.provider_limit_reached` (if implemented in future)
- "Rate limit reached" messages in logs

**Actions:**
1. **Identify the Source:**
   - Check if a specific tenant ID is causing the spike in traffic.
   - Analyze token usage per tenant in Cloud Monitoring.
2. **Apply Tenant Throttling:**
   - Reduce `maxConcurrentRequests` for the offending tenant in `TENANT_POLICIES_JSON`.
   - Lower `maxTokens` for the tenant if they are sending excessively large prompts.
3. **Infrastructure Scaling:**
   - If the limit is hit on our own provider account, request a quota increase from the provider.
   - Switch to a different provider/model with higher remaining quota for the affected tenant.

---

## 3. Global Concurrency Limit Reached

**Symptoms:**
- Error code: `concurrency.global_limit_reached`
- Large spike in 429 responses sent by the Gateway
- `inflight` count in `GET /ready` is at or near `MAX_CONCURRENT_REQUESTS`

**Actions:**
1. **Check System Health:**
   - Verify Cloud Run instance count and CPU/Memory utilization.
   - If utilization is low, increase `MAX_CONCURRENT_REQUESTS` in the environment variables.
2. **Scale Cloud Run:**
   - Increase the maximum number of Cloud Run instances if the global traffic has increased.
3. **Analyze Traffic Patterns:**
   - Determine if the load is legitimate or a potential DDoS/misconfigured client.
   - If a single tenant is monopolizing the gateway, enforce a stricter `maxConcurrentRequests` in their tenant policy.

---

## 4. Tenant Limit Reached

**Symptoms:**
- Error code: `concurrency.tenant_limit_reached` or `tenant.max_tokens_exceeded`
- Specific clients receiving 429 while others are unaffected

**Actions:**
1. **Verify Policy:**
   - Check `TENANT_POLICIES_JSON` for the current limits of the affected tenant.
2. **Adjust Limits:**
   - If the tenant's use case justifies higher limits, update the policy JSON.
   - If the tenant is misbehaving, keep the limits and notify the tenant's technical lead.

---

## 5. Deployment Rollback

**Trigger:**
- Sustained increase in `503` or `server.internal_error` immediately after a deploy.
- Regression in core functionality (e.g., streaming broken, auth failing).
- High P95 latency (>10s) not related to provider outages.

**Procedure:**
1. **List Revisions:**
   ```bash
   gcloud run revisions list --service ai-gateway --region europe-west2 --limit 5
   ```
2. **Identify Stable Revision:** Look for the revision ID that was active before the latest deployment.
3. **Rollback Traffic:**
   ```bash
   gcloud run services update-traffic ai-gateway \
     --to-revisions=STABLE_REVISION_ID=100 \
     --region europe-west2
   ```
4. **Verify Rollback:**
   - Confirm `GET /health` and `GET /ready` return 200 on the rolled-back revision.
   - Monitor error rates in the GCP Console.

---

## 6. High Latency Spikes

**Symptoms:**
- P95 latency `> 5s` for sustained period
- Alerts from Cloud Monitoring
- Client timeouts

**Actions:**
1. **Isolate the Cause:**
   - Check if the latency is provider-specific (check provider histograms).
   - Check if the latency is model-specific (e.g., GPT-4 is slower than GPT-3.5).
   - Check for "cold starts" in Cloud Run if instance count is low.
2. **Mitigation:**
   - Encourage tenants to use faster models (e.g., Gemini Flash, GPT-4o-mini).
   - Increase "min instances" in Cloud Run to reduce cold start impact if traffic is bursty.
   - Review and optimize any middleware or logging overhead if global.
