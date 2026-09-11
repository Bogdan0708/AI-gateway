import { describe, expect, it } from "vitest";
import {
  authenticatedReadinessResponseSchema,
  chatCompletionResponseSchema,
  estimateResponseSchema,
  embeddingsResponseSchema,
  healthResponseSchema,
  providersResponseSchema,
  publicReadinessResponseSchema,
  simpleCompletionResponseSchema,
  structuredErrorResponseSchema,
} from "../contracts/v1.contract";

describe("v1 response contracts", () => {
  it("accepts the current /health response shape", () => {
    expect(() =>
      healthResponseSchema.parse({
        status: "healthy",
        service: "ai-gateway",
        version: "3.0.0",
        providers: ["openai", "claude"],
        timestamp: "2026-03-11T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("accepts a /health response shape with a commit field", () => {
    expect(() =>
      healthResponseSchema.parse({
        status: "healthy",
        service: "ai-gateway",
        version: "3.0.0",
        providers: ["openai", "claude"],
        timestamp: "2026-03-11T00:00:00.000Z",
        commit: "deadbeef",
      }),
    ).not.toThrow();
  });

  it("accepts the current public /ready response shape", () => {
    expect(() =>
      publicReadinessResponseSchema.parse({
        status: "ready",
        service: "ai-gateway",
        version: "3.0.0",
        timestamp: "2026-03-11T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("accepts the authenticated /ready response shape", () => {
    expect(() =>
      authenticatedReadinessResponseSchema.parse({
        status: "ready",
        service: "ai-gateway",
        version: "3.0.0",
        master_key_configured: true,
        inflight: { global: 0 },
        providers: [
          {
            id: "openai",
            enabled: true,
            ready: true,
            reason: "reachable (200)",
          },
        ],
        timestamp: "2026-03-11T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("accepts the /providers response shape", () => {
    expect(() =>
      providersResponseSchema.parse({
        providers: [
          {
            id: "openai",
            enabled: true,
            defaultModel: "gpt-4o-mini",
            models: ["gpt-4o-mini", "gpt-4o"],
          },
        ],
        tenant_id: "tenant-a",
      }),
    ).not.toThrow();
  });

  it("accepts the /v1/embeddings response shape", () => {
    expect(() =>
      embeddingsResponseSchema.parse({
        object: "list",
        data: [
          {
            object: "embedding",
            index: 0,
            embedding: [0.1, 0.2, 0.3],
          },
        ],
        model: "text-embedding-3-small",
        provider: "openai",
        usage: {
          prompt_tokens: 3,
          total_tokens: 3,
        },
        latency_ms: 12,
        tenant_id: "tenant-a",
      }),
    ).not.toThrow();
  });

  it("accepts the /v1/chat/completions response shape", () => {
    expect(() =>
      chatCompletionResponseSchema.parse({
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1741651200,
        model: "gpt-4o-mini",
        provider: "openai",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "hello",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
        latency_ms: 42,
        tenant_id: "tenant-a",
      }),
    ).not.toThrow();
  });

  it("accepts the /v1/estimate response shape", () => {
    expect(() =>
      estimateResponseSchema.parse({
        object: "estimate",
        provider: "openai",
        model: "gpt-4o-mini",
        usage: {
          prompt_tokens: 12,
          completion_tokens: 256,
          total_tokens: 268,
        },
        cost: {
          usd: 0.000155,
          cents: 0.0155,
        },
        pricing: {
          input_per_1k_usd: 0.00015,
          output_per_1k_usd: 0.0006,
        },
        tenant_id: "tenant-a",
      }),
    ).not.toThrow();
  });

  it("accepts the /complete response shape and preserves camelCase usage fields", () => {
    expect(() =>
      simpleCompletionResponseSchema.parse({
        content: "hello",
        provider: "openai",
        model: "gpt-4o-mini",
        usage: {
          promptTokens: 8,
          completionTokens: 3,
          totalTokens: 11,
        },
        latency_ms: 30,
        tenant_id: "tenant-a",
      }),
    ).not.toThrow();
  });

  it("rejects snake_case usage fields on /complete so casing drift is explicit", () => {
    const result = simpleCompletionResponseSchema.safeParse({
      content: "hello",
      provider: "openai",
      model: "gpt-4o-mini",
      usage: {
        prompt_tokens: 8,
        completion_tokens: 3,
        total_tokens: 11,
      },
      latency_ms: 30,
    });

    expect(result.success).toBe(false);
  });

  it("accepts structured error payloads with stable error codes", () => {
    expect(() =>
      structuredErrorResponseSchema.parse({
        error: {
          message: "Unsupported provider: bad-vendor",
          type: "routing_error",
          code: "routing.unsupported_provider",
        },
      }),
    ).not.toThrow();
  });
});
