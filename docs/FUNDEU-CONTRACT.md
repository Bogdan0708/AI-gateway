# FundEU Compatibility Contract

This document defines the explicit contract between the AI Gateway and the FundEU platform (`EU-Funds` repo).

## Endpoints

### Required (Production)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/v1/chat/completions` | POST | Bearer token | Chat completion (OpenAI-compatible) |
| `/v1/embeddings` | POST | Bearer token | Text embeddings for RAG/search |
| `/health` | GET | None | Liveness probe |
| `/ready` | GET | None (public) / Bearer (detailed) | Readiness probe |

### Optional (Streaming)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/v1/chat/completions` (stream: true) | POST | Bearer token | SSE streaming chat completion |

Streaming is activated by setting `stream: true` in the request body. The response uses `text/event-stream` content type with OpenAI-compatible SSE chunk format (`chat.completion.chunk`).

## Authentication

- All non-public endpoints require `Authorization: Bearer <GATEWAY_MASTER_KEY>`
- FundEU should configure `AI_GATEWAY_API_KEY` env var with the gateway master key
- Tenant identity via `X-Tenant-ID` header (preferred) or `tenant_id` body field

## Request Format

### Chat Completion

```json
{
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "provider": "openai",
  "model": "gpt-4o-mini",
  "max_tokens": 2048,
  "temperature": 0.7,
  "stream": false,
  "allow_fallback": true
}
```

All fields except `messages` are optional.

### Embeddings

```json
{
  "input": "text to embed",
  "model": "text-embedding-3-small",
  "provider": "openai"
}
```

`input` can be a string or array of strings.

## Response Format

### Chat Completion (non-streaming)

```json
{
  "id": "chatcmpl-<uuid>",
  "object": "chat.completion",
  "created": 1741651200,
  "model": "gpt-4o-mini",
  "provider": "openai",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "..."},
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 5,
    "total_tokens": 15
  },
  "latency_ms": 42,
  "tenant_id": "fundeu"
}
```

Usage fields are **snake_case** on this endpoint.

### Chat Completion (streaming)

Each SSE event:
```
data: {"id":"chatcmpl-<uuid>","object":"chat.completion.chunk","created":1741651200,"model":"gpt-4o-mini","provider":"openai","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: [DONE]
```

The final chunk includes `usage` with token counts.

### Embeddings

```json
{
  "object": "list",
  "data": [{"object": "embedding", "index": 0, "embedding": [0.1, ...]}],
  "model": "text-embedding-3-small",
  "provider": "openai",
  "usage": {"prompt_tokens": 7, "total_tokens": 7}
}
```

## Error Format

All errors follow a stable structure:

```json
{
  "error": {
    "message": "Human-readable description",
    "type": "routing_error | tenant_policy_error | ai_error | request_error",
    "code": "routing.unsupported_provider"
  }
}
```

Error codes are stable and should be used for programmatic error handling.

## Stability Guarantees

- Response field names and types will not change without a major version bump
- The `maxTokens` and `allowFallback` camelCase aliases remain supported
- `/health` will never trigger outbound provider probes
- Public `/ready` remains lightweight and anonymous
- Tenant identity mismatch (header vs body) remains a hard error
- Fallback does not mask client 4xx errors

## Gateway URL

Production: `https://ai-gateway-382299704849.europe-west2.run.app`

## Integration Points in FundEU

- `app/src/lib/ai/client.ts` — primary gateway client
- `app/src/lib/ai/providers/gateway.ts` — gateway provider abstraction
- `app/src/app/api/ai/wizard/chat/route.ts` — streaming chat route
