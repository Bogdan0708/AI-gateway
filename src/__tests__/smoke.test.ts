import { describe, expect, it } from "vitest";
import {
  buildChatCompletionResponse,
  buildEstimateResponse,
  buildEmbeddingResponse,
  buildHealthResponse,
  buildSimpleCompletionResponse,
} from "../index";

describe("response builders", () => {
  it("builds the health response shape", () => {
    const response = buildHealthResponse(["openai"]);

    expect(response.status).toBe("healthy");
    expect(response.service).toBe("ai-gateway");
    expect(response.providers).toEqual(["openai"]);
    expect(response.timestamp).toBeDefined();
  });

  it("builds the embeddings response shape", () => {
    const response = buildEmbeddingResponse({
      embeddings: [[0.1, 0.2, 0.3]],
      provider: "openai",
      model: "text-embedding-3-small",
      usage: { promptTokens: 7, totalTokens: 7 },
      latencyMs: 12,
      tenantId: "tenant-a",
    });

    expect(response.object).toBe("list");
    expect(response.data[0].object).toBe("embedding");
    expect(response.model).toBe("text-embedding-3-small");
    expect(response.provider).toBe("openai");
    expect(response.usage.total_tokens).toBe(7);
    expect(response.tenant_id).toBe("tenant-a");
  });

  it("builds the OpenAI-compatible chat completion response", () => {
    const response = buildChatCompletionResponse({
      content: "Hello from mock",
      provider: "openai",
      model: "gpt-4o-mini",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      latencyMs: 42,
      tenantId: "tenant-a",
    });

    expect(response.object).toBe("chat.completion");
    expect(response.id).toMatch(/^chatcmpl-/);
    expect(response.choices[0].message.content).toBe("Hello from mock");
    expect(response.choices[0].message.role).toBe("assistant");
    expect(response.usage.total_tokens).toBe(15);
    expect(response.provider).toBe("openai");
    expect(response.tenant_id).toBe("tenant-a");
  });

  it("builds the simple completion response shape", () => {
    const response = buildSimpleCompletionResponse({
      content: "Simple response",
      provider: "openai",
      model: "gpt-4o-mini",
      usage: { promptTokens: 8, completionTokens: 3, totalTokens: 11 },
      latencyMs: 30,
      tenantId: "tenant-a",
    });

    expect(response.content).toBe("Simple response");
    expect(response.provider).toBe("openai");
    expect(response.model).toBe("gpt-4o-mini");
    expect(response.usage.totalTokens).toBe(11);
    expect(response.tenant_id).toBe("tenant-a");
  });

  it("builds the estimate response shape", () => {
    const response = buildEstimateResponse({
      provider: "openai",
      model: "gpt-4o-mini",
      usage: { promptTokens: 12, completionTokens: 256, totalTokens: 268 },
      costUsd: 0.000155,
      costCents: 0.0155,
      inputCostPer1KUsd: 0.00015,
      outputCostPer1KUsd: 0.0006,
      tenantId: "tenant-a",
    });

    expect(response.object).toBe("estimate");
    expect(response.provider).toBe("openai");
    expect(response.model).toBe("gpt-4o-mini");
    expect(response.usage.total_tokens).toBe(268);
    expect(response.cost.usd).toBe(0.000155);
    expect(response.pricing.input_per_1k_usd).toBe(0.00015);
    expect(response.tenant_id).toBe("tenant-a");
  });
});
