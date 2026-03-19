# Release Process

This gateway is a shared production dependency for FundEU and PrimarIA. A normal "it builds" standard is not sufficient for release.

## Release Gates

A change is eligible for merge only when all of the following are true:

- `npx tsc --noEmit` passes
- `npm run lint` passes
- targeted tests pass for the changed area
- compatibility impact on FundEU is stated
- compatibility impact on PrimarIA is stated
- deploy gating still uses authenticated `/ready`
- rollback path is documented for the release

## Required PR Content

Every production-facing PR should answer:

1. What changed?
2. Which endpoints, middleware, provider flows, or policies changed?
3. FundEU impact: `tested`, `not affected`, or `breaking`
4. PrimarIA impact: `tested`, `not affected`, or `breaking`
5. Contract change: `none`, `additive`, or `breaking`
6. Rollback trigger: what metric or symptom means revert immediately?

## Mandatory Pre-Deploy Checks

- `GET /health` returns `200`
- authenticated `GET /ready` returns `200`
- authenticated `GET /ready` shows at least one `ready: true` provider
- one authenticated `POST /v1/chat/completions` succeeds
- one authenticated `POST /v1/chat/completions` with `stream: true` returns SSE chunks if streaming is enabled
- one authenticated `POST /v1/embeddings` succeeds if embeddings are enabled
- tenant-filtered `GET /providers` behaves correctly for a known tenant

## Mandatory Rollback Triggers

Rollback immediately if any of the following appears after deploy:

- authenticated `/ready` turns `503`
- no enabled provider reports `ready: true`
- cross-tenant request rejection spikes unexpectedly
- fallback rate spikes unexpectedly
- latency or provider error rate materially increases for FundEU or PrimarIA

## Shared-Service Rules

- Do not change response field casing casually.
- Do not remove `maxTokens` or `allowFallback` aliases until consumers are verified.
- Do not change `/health` to include expensive checks.
- Do not promote a revision based on public `/ready` alone.
- Do not merge tenant-policy changes without considering both products.
