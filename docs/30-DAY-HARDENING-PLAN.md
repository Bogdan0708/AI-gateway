# AI Gateway — 30-Day Hardening & Operations Plan

> **Status**: DRAFT — v1.0
> **Date**: 2026-03-03
> **Scope**: AI-Gateway repo (`Bogdan0708/AI-gateway`), shared dependency for **EuFund** + **PrimarIA**
> **Constraint**: PR-only changes. No direct prod changes. No destructive actions.

---

## Executive Summary

AI Gateway is a zero-CI, zero-test, zero-versioning Express service that two production apps depend on. A single bad merge can take down both apps simultaneously. This plan installs the minimum viable safety net in 30 days across 4 phases:

1. **Week 1** — Foundation: test harness, API contract snapshot, CI pipeline
2. **Week 2** — Gate: compatibility matrix, breaking-change detection, branch protection
3. **Week 3** — Observe: SLOs, structured alerts, canary rollout
4. **Week 4** — Harden: dependency scanning, cost guardrails, runbooks, final audit

**Current state of the codebase** (as of v3.0.0):
- 6 provider files, ~700 LoC total in `src/`
- No test framework, no CI, no GitHub Actions, no linter config
- No versioned API schema — contract lives implicitly in Zod schemas in `src/middleware/validate.ts` and response shapes in `src/index.ts`
- No health-check beyond `GET /health` returning a JSON blob
- Rate limit is global (100 req/15 min) — shared across both apps
- Fallback chain is hardcoded: openai → claude → gemini → xai → groq → perplexity
- Unused dependencies in `package.json`: `ioredis`, `pg` (no code references)
- Gemini token counting is an estimate (`content.length / 4`), not actual usage

---

## Phase 1 — Foundation (Days 1–7)

### 1.1 Install Test Harness

**Goal**: Ability to run `npm test` and get a pass/fail on every PR.

| Task | File/Path | Detail |
|------|-----------|--------|
| Add Vitest + supertest | `package.json` | `vitest`, `supertest`, `@types/supertest` as devDependencies |
| Vitest config | `vitest.config.ts` | Minimal config, `src/**/*.test.ts` glob |
| Add `test` script | `package.json` | `"test": "vitest run"`, `"test:watch": "vitest"` |
| Smoke tests | `src/__tests__/smoke.test.ts` | Tests below |

**Smoke tests to write (PR #1)**:

```
# src/__tests__/smoke.test.ts — test against the exported `app`

1. GET /health → 200, body.status === "healthy", body.version matches package.json
2. GET /ping → 200, body === "pong"
3. GET /providers → 200, body.providers is array
4. POST /v1/chat/completions without auth → 401
5. POST /v1/chat/completions with auth, empty messages → 400
6. POST /v1/chat/completions with auth, messages=[{role:"user",content:"x"}]
   → (mock provider) 200, body has choices[0].message.content
7. POST /complete without auth → 401
8. POST /complete with auth, missing prompt → 400
9. POST /complete with auth, prompt="x"
   → (mock provider) 200, body has content
```

**Provider mocking strategy**: Stub `providers/index.ts:complete` at the module level — tests must never call real AI APIs. Use Vitest's `vi.mock()`.

### 1.2 API Contract Snapshot

**Goal**: Machine-readable definition of "what the apps depend on".

| Task | File/Path | Detail |
|------|-----------|--------|
| Create contract file | `contracts/v1.contract.ts` | Zod schemas for request + response of each endpoint |
| Contract test suite | `src/__tests__/contract.test.ts` | Validates that actual responses match contract schemas |

**Contract definitions** (extracted from current `src/index.ts` response shapes):

```
contracts/v1.contract.ts

ChatCompletionResponse:
  id: string (starts with "chatcmpl-")
  object: literal "chat.completion"
  created: number
  model: string
  provider: ProviderName
  choices: [{index: 0, message: {role: "assistant", content: string}, finish_reason: string}]
  usage: {prompt_tokens: number, completion_tokens: number, total_tokens: number}
  latency_ms: number

SimpleCompletionResponse:
  content: string
  provider: ProviderName
  model: string
  usage: {promptTokens: number, completionTokens: number, totalTokens: number}
  latency_ms: number

ErrorResponse:
  error: {message: string, type: string}

HealthResponse:
  status: "healthy"
  service: "ai-gateway"
  version: string
  providers: string[]
  timestamp: string (ISO 8601)
```

**IMPORTANT**: Note the inconsistency — `/v1/chat/completions` returns `prompt_tokens` (snake_case) while `/complete` returns `promptTokens` (camelCase). This is a real bug in the current API surface. The contract must document the *current* behavior, not the ideal behavior. Fixing it is a breaking change tracked in Phase 2.

### 1.3 CI Pipeline (GitHub Actions)

**Goal**: No PR merges without green checks.

| Task | File/Path |
|------|-----------|
| CI workflow | `.github/workflows/ci.yml` |

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build
      - run: npm test
```

### 1.4 Add Linting

| Task | File/Path |
|------|-----------|
| ESLint config | `eslint.config.mjs` |
| Add scripts | `package.json` → `"lint": "eslint src"`, `"lint:fix": "eslint src --fix"` |
| Add to CI | `.github/workflows/ci.yml` → step after `npm ci` |

---

## Phase 2 — Compatibility Gate (Days 8–14)

### 2.1 Breaking-Change Detection

**Goal**: Any PR that changes the API contract shape is flagged automatically.

| Task | File/Path | Detail |
|------|-----------|--------|
| Contract snapshot file | `contracts/v1.snapshot.json` | Serialized Zod schemas (generated, committed) |
| Snapshot comparison step | `src/__tests__/contract.test.ts` | Compare current schemas against snapshot; fail if different |
| Update script | `package.json` → `"contract:update"` | Regenerate snapshot (run manually when intentional) |
| Add to CI | `.github/workflows/ci.yml` | Step: `npm run test` already covers this |

**Pass/Fail logic**:
- `contracts/v1.snapshot.json` is committed to git
- On each PR, contract tests parse the *actual* response schemas and compare to snapshot
- If snapshot differs → **FAIL** with message: `"API contract changed. If intentional, run npm run contract:update and include the updated snapshot in this PR."`
- Reviewer sees exactly which fields changed in the snapshot diff

### 2.2 App-Lane Compatibility Matrix

**Goal**: Explicit documentation of which app uses which endpoints and fields.

| Task | File/Path |
|------|-----------|
| Compatibility matrix | `contracts/COMPATIBILITY.md` |

```markdown
# App Compatibility Matrix

| Field / Behavior               | EuFund | PrimarIA | Notes                            |
|---------------------------------|--------|----------|----------------------------------|
| POST /v1/chat/completions       | YES    | YES      | Primary endpoint for both        |
| POST /complete                  | NO     | YES      | PrimarIA legacy endpoint         |
| response.choices[].message      | YES    | YES      | Must remain OpenAI-compatible    |
| response.provider               | YES    | YES      | Used for logging/display         |
| response.usage (snake_case)     | YES    | NO       | /v1/chat/completions format      |
| response.usage (camelCase)      | NO     | YES      | /complete format                 |
| fallback across providers       | YES    | YES      | Both rely on auto-fallback       |
| max_tokens param (snake_case)   | YES    | YES      | Primary format                   |
| maxTokens param (camelCase)     | NO     | YES      | Legacy compat                    |
| rate limit (100/15min global)   | SHARED | SHARED   | RISK: one app can starve other   |
```

> **Action item**: This matrix MUST be validated against actual EuFund and PrimarIA client code. The table above is inferred from the gateway's API surface.

### 2.3 Branch Protection Rules

| Setting | Value |
|---------|-------|
| Require PR before merge to `main` | ON |
| Required status checks | `gate` (CI job name) |
| Require 1 approval | ON |
| Dismiss stale reviews on new push | ON |
| Do not allow bypassing | ON (even for admins) |

Configure via GitHub repo Settings → Branches → Branch protection rules → `main`.

### 2.4 PR Template

| Task | File/Path |
|------|-----------|
| PR template | `.github/pull_request_template.md` |

```markdown
## What changed

## Why

## App impact
- [ ] EuFund: tested / not affected / breaking (explain)
- [ ] PrimarIA: tested / not affected / breaking (explain)

## Contract
- [ ] No API contract changes
- [ ] Contract snapshot updated (`npm run contract:update`)
- [ ] Breaking change: migration plan attached

## Checklist
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `npm run lint` passes
```

---

## Phase 3 — Reliability & Observability (Days 15–21)

### 3.1 SLO Definitions

| SLO | Target | Measurement | Burn-rate alert |
|-----|--------|-------------|-----------------|
| **Availability** | 99.5% (3.6h downtime/month) | `1 - (5xx responses / total responses)` on `/v1/chat/completions` + `/complete` | >1% error rate over 5 min |
| **Latency (p95)** | < 15 seconds | End-to-end from request received to response sent | p95 > 20s over 5 min window |
| **Latency (p50)** | < 5 seconds | Same | p50 > 10s over 5 min window |
| **Fallback rate** | < 10% of requests | Requests where `result.provider !== requested provider` | >25% over 15 min |

**Why these numbers**: AI provider calls are inherently slow (2–10s typical). 15s p95 allows for one timeout+fallback (30s timeout is too generous — see recommendation below). 99.5% accommodates upstream provider outages that exhaust the fallback chain.

### 3.2 Structured Log Fields for Alerting

Current logging is already Pino/JSON. Add these fields to completion log lines:

| Field | Source | Purpose |
|-------|--------|---------|
| `provider_requested` | `req.body.provider` | Detect fallback |
| `provider_used` | `result.provider` | Detect fallback |
| `is_fallback` | `requested !== used` | Alert trigger |
| `tenant_id` | `req.body.tenant_id` | Per-app breakdown |
| `error_code` | Provider error type | Classify failures |

**Implementation**: Add to the existing `req.log.info(...)` calls in `src/index.ts:126-133` and `src/index.ts:211-218`.

### 3.3 GCP Cloud Run Alerts (via Cloud Monitoring)

| Alert | Condition | Channel |
|-------|-----------|---------|
| Error spike | 5xx rate > 5% for 3 consecutive minutes | Email / Slack |
| Latency spike | p95 latency > 20s for 5 minutes | Email / Slack |
| Instance crash loop | Container restarts > 3 in 5 minutes | Email / Slack |
| All providers down | `/health` returns 0 enabled providers | PagerDuty-equivalent |
| Rate limit saturation | 429 responses > 10% of total | Email |

### 3.4 Canary Rollout Recommendation

Cloud Run supports traffic splitting natively:

```
Phase 1: Deploy new revision with 0% traffic (tag: "canary")
Phase 2: Route 10% traffic to canary
Phase 3: Monitor for 15 minutes — check error rate + latency
Phase 4: If healthy → route 100%. If degraded → route 0% back.
```

**Rollback criteria** (any one triggers automatic rollback to previous revision):
1. 5xx error rate > 5% sustained 3 minutes
2. p95 latency > 25 seconds sustained 3 minutes
3. Health endpoint returns non-200
4. Any provider that was enabled becomes disabled (config regression)

**Implementation**: Script in `scripts/deploy-canary.sh` wrapping `gcloud run services update-traffic`.

### 3.5 Timeout Reduction

**Current**: 30 seconds per provider. With 6 providers in fallback chain, worst case = 180 seconds.

**Recommendation**: Reduce to 15 seconds. Worst realistic case (3 enabled providers) = 45 seconds, still within Cloud Run's default 300s request timeout.

---

## Phase 4 — Security, Cost & Docs (Days 22–30)

### 4.1 Dependency Scanning

| Task | File/Path | Cadence |
|------|-----------|---------|
| Dependabot config | `.github/dependabot.yml` | Weekly for npm |
| GitHub Actions audit | `.github/workflows/ci.yml` → add `npm audit` step | Every PR |
| Remove unused deps | `package.json` | One-time: remove `ioredis`, `pg`, `@types/pg` |

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
```

### 4.2 Model Usage Guardrails

| Guardrail | Current | Recommended |
|-----------|---------|-------------|
| Rate limit | 100 req/15 min (global) | Per-tenant: 60 req/15 min (identified by `tenant_id` or API key) |
| Max tokens | 16384 (validation) | Keep, but log warnings at > 8192 |
| Max messages | 50 per request | Keep |
| Max content | 32000 chars | Keep |
| Cost ceiling | None | Add `X-Max-Cost-Cents` header support — reject if estimated cost > threshold |

**Per-tenant rate limiting** implementation sketch:
```typescript
// Key off tenant_id from request body, falling back to IP
const keyGenerator = (req) => req.body?.tenant_id || req.ip;
```

This is critical: right now one app can consume the entire 100-request budget and starve the other.

### 4.3 Fallback Policy (formalized)

| Rule | Detail |
|------|--------|
| Fallback order | Configurable via `FALLBACK_CHAIN` env var (comma-separated), default: `openai,claude,gemini,xai,groq,perplexity` |
| Max fallback attempts | 3 (not all 6 — fail fast) |
| Fallback triggers | Timeout, 5xx from provider, network error |
| Non-fallback errors | 4xx from provider (bad request), auth failure → fail immediately, do not try next |
| Circuit breaker | If a provider fails 5 consecutive times in 5 minutes, skip it for 2 minutes |

### 4.4 Required Docs & Templates

| File | Purpose | Added in Phase |
|------|---------|----------------|
| `.github/workflows/ci.yml` | CI pipeline | 1 |
| `.github/pull_request_template.md` | PR checklist with app-impact section | 2 |
| `.github/dependabot.yml` | Dependency scanning | 4 |
| `contracts/v1.contract.ts` | Machine-readable API contract | 1 |
| `contracts/v1.snapshot.json` | Committed contract snapshot for diff | 2 |
| `contracts/COMPATIBILITY.md` | App-lane compatibility matrix | 2 |
| `docs/RUNBOOK.md` | Incident response procedures | 4 |
| `docs/SLO.md` | SLO definitions and measurement | 3 |
| `docs/RELEASE-PROCESS.md` | How to ship a change safely | 2 |
| `vitest.config.ts` | Test configuration | 1 |
| `eslint.config.mjs` | Lint configuration | 1 |
| `scripts/deploy-canary.sh` | Canary deployment script | 3 |

### 4.5 Runbook (docs/RUNBOOK.md)

Must cover:
1. **All providers failing**: Check each provider's status page. Verify API keys in Secret Manager. Check Cloud Run logs for config errors.
2. **One app starving the other**: Check rate limit logs. Identify tenant. Temporarily increase limit or block abusive pattern.
3. **Latency spike**: Check which provider is slow (log field `provider_used` + `latencyMs`). Temporarily remove from fallback chain via env var.
4. **Contract break detected in CI**: Do NOT merge. Check `contracts/COMPATIBILITY.md` for affected apps. Coordinate with app teams.
5. **Rollback procedure**: `gcloud run services update-traffic ai-gateway --to-revisions=PREVIOUS_REVISION=100 --region=REGION`

---

## Release Gating Policy

### Definition of "Ready for Human Merge"

A PR to `main` is eligible for human review + merge only when ALL of these pass:

| # | Gate | Mechanism | Fail = Block? |
|---|------|-----------|---------------|
| 1 | TypeScript compiles | `npm run build` in CI | YES |
| 2 | Lint passes | `npm run lint` in CI | YES |
| 3 | All tests pass | `npm test` in CI | YES |
| 4 | Contract snapshot unchanged OR explicitly updated | Contract test comparison | YES |
| 5 | PR template filled | App-impact checkboxes | YES (review requirement) |
| 6 | No `npm audit` critical/high vulns | `npm audit --audit-level=high` | YES |
| 7 | Human approval (1 reviewer) | GitHub branch protection | YES |

### What Constitutes a Breaking Change

| Change | Breaking? | Required action |
|--------|-----------|-----------------|
| Add optional field to response | NO | Update contract snapshot |
| Remove field from response | **YES** | Check COMPATIBILITY.md, coordinate with app teams |
| Rename field in response | **YES** | Same |
| Change field type | **YES** | Same |
| Add required field to request | **YES** | Same |
| Remove a provider from registry | **YES** | Verify no app hardcodes that provider |
| Change fallback order | **MAYBE** | Document in PR, review with app teams |
| Change rate limit thresholds | **MAYBE** | Check per-app impact |
| Change validation constraints (e.g. max_tokens ceiling) | **MAYBE** | Verify apps stay within new limits |

---

## Compatibility Gate — Explicit Pass/Fail Conditions

```
PASS conditions (ALL must be true):
  ✓ npm run build exits 0
  ✓ npm run lint exits 0
  ✓ npm test exits 0 (includes contract tests)
  ✓ contracts/v1.snapshot.json has no uncommitted diff
    OR the diff is intentional AND PR description explains app impact
  ✓ npm audit --audit-level=high exits 0
  ✓ PR template app-impact section is filled for both EuFund and PrimarIA

FAIL conditions (ANY triggers block):
  ✗ Build fails
  ✗ Any test fails
  ✗ Contract snapshot changed without explicit acknowledgment
  ✗ High/critical vulnerability in npm audit
  ✗ PR template app-impact section is empty
```

---

## First 2 Weeks — Implementation Backlog (PR Batches)

### PR #1: Test harness bootstrap (Day 1–2)
```
Files:
  + package.json                     (add vitest, supertest, @types/supertest, scripts)
  + vitest.config.ts                 (minimal config)
  + src/__tests__/smoke.test.ts      (9 smoke tests listed in §1.1)
```
**Size**: ~150 LoC new. Zero changes to production code.

### PR #2: API contract snapshot (Day 2–3)
```
Files:
  + contracts/v1.contract.ts         (Zod schemas for all response shapes)
  + contracts/v1.snapshot.json       (generated snapshot)
  + src/__tests__/contract.test.ts   (snapshot comparison tests)
  + package.json                     (add contract:update script)
```
**Size**: ~200 LoC new. Zero changes to production code.

### PR #3: CI pipeline (Day 3–4)
```
Files:
  + .github/workflows/ci.yml        (build + lint + test + audit)
  + eslint.config.mjs               (TypeScript ESLint config)
  + package.json                     (add lint scripts)
```
**Size**: ~80 LoC config. Zero changes to production code.

### PR #4: Remove dead dependencies (Day 4)
```
Files:
  ~ package.json                     (remove ioredis, pg, @types/pg)
  ~ package-lock.json                (regenerated)
```
**Size**: Deletion only. Reduces attack surface and image size.

### PR #5: Branch protection + PR template (Day 5)
```
Files:
  + .github/pull_request_template.md
Manual:
  Configure branch protection on GitHub (see §2.3)
```

### PR #6: Compatibility matrix + release process doc (Day 6–7)
```
Files:
  + contracts/COMPATIBILITY.md
  + docs/RELEASE-PROCESS.md
```
**Dependency**: Requires input from EuFund and PrimarIA codebases to validate the matrix.

### PR #7: Enhanced logging fields (Day 8–9)
```
Files:
  ~ src/index.ts                     (add provider_requested, is_fallback, tenant_id to log lines)
```
**Size**: ~20 LoC changed. Non-breaking (log format is not part of API contract).

### PR #8: Per-tenant rate limiting (Day 9–10)
```
Files:
  ~ src/index.ts                     (refactor rate limit key generator)
```
**Size**: ~15 LoC changed. Non-breaking for apps (relaxes limit per-tenant vs global).

### PR #9: Timeout reduction + max fallback attempts (Day 10–11)
```
Files:
  ~ src/providers/*.ts               (TIMEOUT_MS: 30000 → 15000 in all 6 files)
  ~ src/providers/index.ts           (add maxAttempts=3 to fallback loop)
```
**Size**: ~20 LoC changed. Behavior change — test thoroughly.

### PR #10: Dependabot + npm audit in CI (Day 11–12)
```
Files:
  + .github/dependabot.yml
  ~ .github/workflows/ci.yml         (add npm audit step)
```

### PR #11: SLO doc + canary deploy script (Day 12–14)
```
Files:
  + docs/SLO.md
  + scripts/deploy-canary.sh
```

---

## TOP RISKS

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| **R1** | **No tests exist today — first merge after v3.0.0 could break both apps silently** | HIGH | CRITICAL | PR #1 is top priority. Do not merge any feature PR until smoke tests exist. |
| **R2** | **Usage field casing inconsistency** (`prompt_tokens` vs `promptTokens` across endpoints) — apps may depend on either | MEDIUM | HIGH | Document in contract as-is. Fix only after confirming both apps' client code. Do NOT "normalize" without coordinating. |
| **R3** | **Global rate limit (100/15min) shared between two apps** — one app can starve the other during peak | HIGH | HIGH | PR #8 (per-tenant rate limiting) is the fix. Until then, 100/15min is the shared ceiling. |
| **R4** | **30s timeout × 6 providers = 180s worst case** — Cloud Run may terminate the request (default 300s) | LOW | MEDIUM | PR #9 reduces timeout to 15s and caps fallback at 3 attempts. |
| **R5** | **Unused dependencies (ioredis, pg) increase attack surface and image size** | MEDIUM | LOW | PR #4 removes them. Trivial PR, no behavior change. |
| **R6** | **No circuit breaker — a repeatedly-failing provider is retried every request** | MEDIUM | MEDIUM | Phase 4 enhancement. Until then, fallback chain absorbs it (with latency cost). |
| **R7** | **Version hardcoded in source** (`index.ts:78` returns `"3.0.0"`) — will drift from `package.json` | LOW | LOW | Fix: read from `package.json` at startup. Include in any early PR. |
| **R8** | **Gemini token counting is estimated** (`content.length / 4`) — usage reporting is inaccurate | LOW | LOW | Document as known limitation. Fix when Gemini SDK exposes actual token counts. |
| **R9** | **No secret rotation mechanism** — `GATEWAY_MASTER_KEY` and provider keys have no rotation policy | MEDIUM | HIGH | Document rotation procedure in RUNBOOK.md. Set calendar reminder for quarterly rotation. |
| **R10** | **CORS wildcards** (`https://*.primaria.ro`, `https://*.eufunding.ro`) — subdomain takeover could bypass auth** | LOW | HIGH | Audit all subdomains. Consider narrowing to explicit origins. |
