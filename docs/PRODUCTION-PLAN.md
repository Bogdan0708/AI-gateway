# AI Gateway — Production Plan

**Status: LARGELY PRODUCTION-READY**
**Estimated effort: 1-2 weeks**
**Current: v3.0.0, deployed on GCP Cloud Run**

---

## Current State

- 53 tests, ALL passing
- Zero lint/type errors
- Streaming, embeddings, tenant policies implemented
- Canary deployment with smoke tests
- Strong error handling with 17 error codes + fallback chains
- 4 transitive dependency vulnerabilities (npm audit)

---

## Phase 1: Immediate Fixes (2-3 days)

### 1.1 Security Patch
- [ ] Run `npm audit fix` to resolve 4 transitive vulnerabilities (path-to-regexp, picomatch, brace-expansion, flatted)
- [ ] Test all endpoints after patching
- [ ] Update `groq-sdk` from 0.37.0 — evaluate v1+ (breaking changes likely)

### 1.2 Observability Gap
- [ ] Add Prometheus `/metrics` endpoint (use `prom-client`)
  - Request latency per provider (histogram)
  - Token usage per request (counter)
  - Fallback frequency (counter)
  - Provider error rates (counter by provider + error code)
  - Active concurrent requests (gauge)
- [ ] Add Cloud Trace exporter (OpenTelemetry) for distributed tracing
- [x] Configure Cloud Monitoring alerts:
  - Provider fallback rate > 10% over 5 min
  - Global error rate > 5%
  - P95 latency > 5s
  - Concurrency > 80% of limit

### 1.3 Missing Runbooks
- [x] Document incident response for: provider outage, rate limit exceeded, deployment rollback
- [x] Add rollback procedure to `docs/cloud-run-rollout.md`

---

## Phase 2: Hardening (1 week)

### 2.1 Testing
- [ ] Add E2E streaming test over real HTTP (not just ReadableStream unit)
- [x] Add load test script (k6 or autocannon) to validate rate limiting + concurrency under real traffic
- [ ] Add contract regression test: verify response shapes haven't changed

### 2.2 Caching
- [ ] Implement optional in-memory request dedup cache (same messages + model + temperature within 5s window)
- [ ] Add cache hit/miss metrics

### 2.3 Cost Controls
- [ ] Add per-tenant spend cap (daily/monthly token limit)
- [ ] Add cost estimation endpoint: `POST /v1/estimate` (returns estimated token count + cost before execution)
- [ ] Log cost per request for billing visibility

### 2.4 API Documentation
- [x] Generate OpenAPI spec from Zod contracts in `src/contracts/v1.contract.ts`
- [ ] Serve Swagger UI at `/docs` (optional, behind auth)

---

## Phase 3: Operational Maturity (ongoing)

### 3.1 Monitoring Dashboard
- [ ] Build Cloud Monitoring dashboard: provider latency, errors, costs, concurrency
- [ ] Set up weekly cost report (total tokens by provider by tenant)

### 3.2 Dependency Maintenance
- [ ] Enable Dependabot for security updates
- [ ] Schedule monthly dependency review

### 3.3 Audit Trail
- [ ] Log tenant policy changes (who changed what, when)
- [ ] Log API key creation/revocation events

---

## Paperclip Agent Assignments

| Agent | Role | Ticket Types |
|-------|------|-------------|
| **Claude Code** | engineer | Security patches, metrics endpoint, caching impl, cost controls, contract tests |
| **Codex** | engineer | Load test scripts, CI improvements, dependency updates, OpenAPI generation |
| **Gemini** | engineer | Runbook writing, dashboard design, cost report templates, API documentation |
