# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Gateway v3.0.0 — a multi-provider AI gateway service that provides a unified OpenAI-compatible API across six AI providers (OpenAI, Anthropic/Claude, Google/Gemini, xAI/Grok, Groq, Perplexity). Built for GCP Cloud Run.

**Status: offline portfolio project** (see `README.md`). The deploy tooling is kept as implementation evidence — do not deploy unless the owner asks.

## Commands

Standard npm scripts are in `package.json`. Run a single test with:

```bash
npx vitest run src/__tests__/smoke.test.ts
```

CI runs: type-check (`npx tsc --noEmit`) → lint → test → audit (`--audit-level=high`, blocking) → deployment safety tests (`python3 -m unittest discover -s tests-deploy -v`) → build.

## Architecture

### Entry Point & Server (`src/index.ts`)

Express server (port 8080) with this middleware stack in order:
1. Helmet (security headers)
2. CORS (configurable origins)
3. JSON body parser (1MB limit)
4. OpenTelemetry middleware (no-op unless `OTEL_ENABLED`)
5. Pino HTTP logger
6. Prometheus HTTP metrics
7. Bearer token auth (`GATEWAY_MASTER_KEY`)
8. Rate limiting (100 req/15 min, keyed per tenant with IP fallback; `/ready` has its own 12/min limiter)

Public paths (no auth, no global rate limit): `/health`, `/ping`, `/ready`, `/metrics`.

Routes are defined inline in `index.ts`, not in separate route files. The file exports `app` (for testing with supertest) and gates `app.listen()` behind `require.main === module` to avoid EADDRINUSE in tests.

### Provider System (`src/providers/`)

Each provider file exports a `ProviderConfig`. The registry in `providers/index.ts` manages all providers and implements the **fallback chain** (openai → claude → gemini → xai → groq → perplexity). Cross-provider fallback is **off by default**: it needs `allow_fallback: true`, is capped by `MAX_FALLBACK_ATTEMPTS` (default 3, including the primary), and only triggers on retryable errors (abort, 5xx, 401/403/429). A model not in the provider's hardcoded `models[]` returns 400 `routing.unsupported_model`.

Key patterns:
- **Lazy client initialization** — SDK clients are created on first use
- **Timeouts** via AbortController: 15s non-streaming, 120s streaming, 2s readiness probes
- **Message format conversion** — each provider adapts the unified `CompletionMessage[]` format to its native API (e.g., Claude splits out system messages; Gemini requires the last message to be from user)
- Provider `enabled` is computed **at module import** from its API key env var (tests must `vi.resetModules()` to change it)
- Perplexity uses raw `fetch()`; xAI uses the `openai` SDK with a custom `baseURL`; the rest use their own SDKs
- Only openai/claude/gemini implement `stream`; only openai implements `embed`
- Adding a provider touches: `types.ts`, the registry + fallback chain in `providers/index.ts`, the `providerNameSchema` enum in `contracts/v1.contract.ts`, and pricing in `lib/estimate.ts`

### Middleware (`src/middleware/`)

- `auth.ts` — Bearer token validation using `timingSafeEqual`; skips the four public paths
- `validate.ts` — Zod-based request body validation with `.passthrough()` (extra fields allowed); messages capped at 50, content at 32K chars, temperature 0–2, max_tokens 1–16384
- `contract.ts` — `validateResponse(schema)` on `/health`, `/providers` and non-stream `/v1/chat/completions`; a response that doesn't match `src/contracts/v1.contract.ts` becomes a 500 `contract_violation`. Change the schema with the response.

### Logging (`src/lib/logger.ts`)

Pino structured JSON logger with `x-request-id` header extraction (or UUID generation). Log level from `LOG_LEVEL` env var.

## Testing

Tests use **vitest** + **supertest**. Test files live at `src/__tests__/*.test.ts` and are excluded from the TypeScript build via `tsconfig.json`.

Most tests use `vi.resetModules()` + `vi.doMock(...)` + `await import("../index")`, setting `GATEWAY_MASTER_KEY` in `beforeEach`. A few use top-level `vi.mock("../providers")` with a static import. Reset shared state with `resetTenantPolicyConfigCache()`, `resetInflightCounts()` and `resetSpendTracking()`. Response builders (`buildHealthResponse`, etc.) are exported from `index.ts` and tested directly.

## API Endpoints

- `POST /v1/chat/completions` — OpenAI-compatible chat completion (returns snake_case usage: `prompt_tokens`)
- `POST /v1/chat/completions` with `stream: true` — SSE; this path skips the concurrency limit, tenant provider/model allowlists, usage recording and contract validation
- `POST /complete` — Simplified completion (takes `prompt` + optional `system`; returns camelCase usage: `promptTokens`)
- `POST /v1/embeddings`, `POST /v1/estimate`
- `GET /health` (includes `commit` from `GIT_SHA`/`K_REVISION`), `GET /ping`, `GET /providers`, `GET /metrics` (Prometheus)
- `GET /ready` — minimal body unauthenticated; with a valid bearer token it probes each provider and returns diagnostics
- Do not remove the request aliases (`max_tokens`/`maxTokens`, `allow_fallback`/`allowFallback`) or change response field casing (see `docs/RELEASE-PROCESS.md`)

## Environment Variables

- `GATEWAY_MASTER_KEY` — required for auth
- `PORT` (default: 8080), `NODE_ENV`, `LOG_LEVEL` (default: info), `CORS_ORIGINS` (comma-separated)
- Provider API keys (each enables its provider): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `PERPLEXITY_API_KEY`
- Tenancy: `REQUIRE_TENANT_ID`, `TENANT_POLICIES_JSON` (if set, unknown tenants get 403)
- Limits: `MAX_CONCURRENT_REQUESTS` (50), `MAX_FALLBACK_ATTEMPTS` (3), `DEDUP_CACHE_ENABLED` (on unless `"false"`), `DEDUP_CACHE_TTL_MS` (15000)
- Other: `PLATFORM_SYSTEM_PROMPTS_ENABLED`, `OTEL_ENABLED`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_VERSION`, `GIT_SHA`
- Spend caps, concurrency counters, dedup cache and rate-limit store are all in-memory per instance

## Build & Deploy

TypeScript compiles to ES2022 CommonJS in `dist/` (do not edit it). Dockerfile uses multi-stage build with `node:20-alpine` and runs as non-root user. Optimized for Cloud Run scale-to-zero.

Deploy is manual only (`workflow_dispatch` in `deploy.yml`): it reruns CI, then `scripts/deploy-canary.sh` deploys a `--no-traffic` revision, checks that `/health` reports the exact `GIT_SHA` and that unauthenticated `/ready` is `ready`, promotes that revision, and rolls traffic back on failure. Changing the `/health` `commit` field or the public `/ready` body breaks it; `tests-deploy/` covers the script with mocks.

## Conventions

- Work lands through PRs from `fix/…`, `docs/…`, `feat/…` branches; Conventional Commits with imperative subjects
- PRs fill in `.github/pull_request_template.md` (consumer impact, contract impact, rollback trigger)
- 2-space indent, double quotes, trailing commas (not enforced by lint; prettier is installed but not configured)
- Unused vars prefixed with `_` are allowed by ESLint
- `AGENTS.md` carries the same rules for Codex — keep the two files consistent when changing either
