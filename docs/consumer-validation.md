# Consumer Validation Guide

Use these checks after deploying `ai-gateway` changes and before tightening tenant policy.

## Prerequisites

Set these shell variables first:

```bash
export GATEWAY_URL="https://your-ai-gateway-url"
export GATEWAY_KEY="replace-me"
export TENANT_ID="replace-with-real-tenant-id"
```

## 1. Gateway Readiness

```bash
curl -sS "$GATEWAY_URL/ready" | jq
```

Expected:
- `status: "ready"`
- public response is intentionally minimal

For detailed diagnostics:

```bash
curl -sS "$GATEWAY_URL/ready" \
  -H "Authorization: Bearer $GATEWAY_KEY" | jq
```

Expected:
- `master_key_configured: true`
- at least one enabled provider with `ready: true`

## 2. Taxes Chatbot Contract

```bash
curl -sS "$GATEWAY_URL/v1/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: $TENANT_ID" \
  -d '{
    "provider": "gemini",
    "model": "gemini-2.0-flash",
    "messages": [
      { "role": "system", "content": "Raspunde concis in limba romana." },
      { "role": "user", "content": "Ce este impozitul pe cladiri?" }
    ],
    "max_tokens": 300
  }' | jq
```

Expected:
- HTTP `200`
- response `provider` and `model` populated
- response includes `tenant_id`
- no `routing.unsupported_model`

## 3. Taxes OCR / Structured Extraction Contract

```bash
curl -sS "$GATEWAY_URL/v1/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: $TENANT_ID" \
  -d '{
    "provider": "gemini",
    "model": "gemini-2.0-flash",
    "messages": [
      {
        "role": "system",
        "content": "Return only valid JSON with keys nume, prenume, cnp."
      },
      {
        "role": "user",
        "content": "NUME POPESCU\nPRENUME ION\nCNP 1800101223344"
      }
    ],
    "max_tokens": 200
  }' | jq
```

Expected:
- HTTP `200`
- assistant content is parseable JSON
- no tenant-policy rejection for a valid tenant

## 4. EU-Funds Embeddings Contract

```bash
curl -sS "$GATEWAY_URL/v1/embeddings" \
  -H "Authorization: Bearer $GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "model": "text-embedding-3-small",
    "input": "Fonduri europene pentru digitalizarea IMM-urilor"
  }' | jq
```

Expected:
- HTTP `200`
- `object: "list"`
- `data[0].object: "embedding"`
- `usage.total_tokens` present

## 5. Routing Error Contract

```bash
curl -sS "$GATEWAY_URL/v1/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "gemini",
    "model": "not-a-real-model",
    "messages": [
      { "role": "user", "content": "hello" }
    ]
  }' | jq
```

Expected:
- HTTP `400`
- `error.type: "routing_error"`
- `error.code: "routing.unsupported_model"`

## 6. Log Checks

In Cloud Logging, verify:

- successful AI calls include `tenantId` for Taxes traffic
- failures include stable `code` values
- no repeated `routing.unsupported_model`
- no repeated `tenant.*` rejections for valid requests
- no repeated `concurrency.global_limit_reached` during normal load
