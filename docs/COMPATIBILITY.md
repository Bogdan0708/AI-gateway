# Shared Consumer Compatibility Matrix

This document captures the current gateway contract for the known downstream consumers:

- `FundEU`
- `PrimarIA`

Status: inferred from the gateway API surface and local repo docs on March 11, 2026.

This is not a substitute for verifying the actual FundEU and PrimarIA client code. Any change marked "shared" or "likely used" must be validated against those consumers before merge.

## Endpoint Matrix

| Endpoint / Behavior | FundEU | PrimarIA | Notes |
|---|---|---|---|
| `GET /health` | Shared | Shared | Public liveness only. Must stay cheap and non-probing. |
| `GET /ready` public | Shared | Shared | Public config-level readiness only. No provider diagnostics should be assumed. |
| `GET /ready` authenticated | Shared | Shared | Deployment-grade readiness with provider diagnostics. |
| `GET /providers` | Likely used | Likely used | Response can be tenant-filtered. Requires auth. |
| `POST /v1/chat/completions` | Yes | Yes | Primary OpenAI-compatible interface. |
| `POST /complete` | Unknown | Likely yes | Legacy simplified interface. Treat as compatibility-sensitive. |
| `POST /v1/embeddings` | Likely yes | Unknown | Likely used by FundEU retrieval/search flows. |

## Request Compatibility

| Field / Behavior | FundEU | PrimarIA | Notes |
|---|---|---|---|
| `Authorization: Bearer <master-key>` | Required | Required | Required on all non-public routes. |
| `x-tenant-id` header | Likely yes | Likely yes | Preferred tenant identity channel. |
| `tenant_id` body field | Likely yes | Likely yes | Still accepted; mismatch with header is rejected. |
| `max_tokens` | Yes | Yes | Preferred request field. |
| `maxTokens` | Unknown | Likely yes | Legacy compatibility field. Do not remove without client verification. |
| `allow_fallback` | Likely yes | Likely yes | Current preferred flag. |
| `allowFallback` | Unknown | Likely yes | Legacy compatibility field. |

## Response Compatibility

| Response Field / Shape | FundEU | PrimarIA | Notes |
|---|---|---|---|
| `chat.completion` OpenAI-like shape | Yes | Yes | High-sensitivity shared contract. |
| `/v1/chat/completions -> usage.prompt_tokens` | Yes | Yes | Snake case. Preserve unless coordinating a breaking change. |
| `/complete -> usage.promptTokens` | Unknown | Likely yes | Camel case. Legacy inconsistency is part of the current contract. |
| `provider` and `model` in success responses | Yes | Yes | Used for debugging, routing visibility, and analytics. |
| `tenant_id` echoed in success responses | Likely yes | Likely yes | Needed for downstream observability and scoping. |
| stable `error.code` values | Shared | Shared | Operationally important for both products. |

## Non-Negotiable Shared Invariants

- `/health` must never trigger outbound provider probes.
- Public `/ready` must remain cheap and safe to call anonymously.
- Authenticated `/ready` is the only deploy-grade readiness signal.
- Tenant mismatches between header and body must remain a hard error.
- Unknown tenant handling must not leak another tenant's policy or provider set.
- Fallback must never silently mask bad client requests by retrying non-retryable provider 4xx errors.
- Any change to response casing, required fields, or endpoint removal is a breaking change until both consumers are verified.

## Review Triggers

A gateway PR requires explicit FundEU and PrimarIA review notes if it changes any of:

- auth behavior
- tenant resolution or tenant policy enforcement
- rate limiting keys or quotas
- fallback policy
- timeout policy
- response field names or types
- `/ready`, `/health`, or deploy promotion logic
- provider availability or model defaults

## Known Contract Risks

- `/complete` still returns camelCase usage fields while `/v1/chat/completions` returns snake_case usage fields.
- Tenant identity can currently come from header or body, which increases compatibility but also increases ambiguity risk.
- Different products may rely on different subsets of providers or models even though the gateway exposes a shared registry.
