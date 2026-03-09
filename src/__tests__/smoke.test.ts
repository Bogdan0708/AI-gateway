import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Mock providers BEFORE importing app — prevents real SDK client initialization
vi.mock("../providers", () => ({
  complete: vi.fn(),
  embed: vi.fn(),
  CompletionRoutingError: class CompletionRoutingError extends Error {
    statusCode: number;
    code: string;

    constructor(
      message: string,
      statusCode = 400,
      code = "routing.unsupported_provider",
    ) {
      super(message);
      this.name = "CompletionRoutingError";
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  listProviders: vi.fn(() => [
    {
      id: "openai",
      enabled: true,
      defaultModel: "gpt-4o-mini",
      models: ["gpt-4o", "gpt-4o-mini"],
    },
    {
      id: "claude",
      enabled: false,
      defaultModel: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
    },
  ]),
}));

// Set env before importing app
process.env.GATEWAY_MASTER_KEY = "test-key-for-unit-tests";

import { app } from "../index";
import { complete, embed, CompletionRoutingError } from "../providers";

const mockedComplete = vi.mocked(complete);
const mockedEmbed = vi.mocked(embed);
const AUTH = { Authorization: "Bearer test-key-for-unit-tests" };

// --- Health & Ping ---

describe("GET /health", () => {
  it("returns 200 with healthy status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.service).toBe("ai-gateway");
    expect(res.body.providers).toBeInstanceOf(Array);
    expect(res.body.timestamp).toBeDefined();
  });
});

// --- POST /v1/embeddings ---

describe("POST /v1/embeddings", () => {
  beforeEach(() => {
    mockedEmbed.mockReset();
    mockedEmbed.mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      provider: "openai",
      model: "text-embedding-3-small",
      usage: { promptTokens: 7, totalTokens: 7 },
      latencyMs: 12,
    });
  });

  it("returns embeddings on success", async () => {
    const res = await request(app)
      .post("/v1/embeddings")
      .set(AUTH)
      .send({ input: "hello world" });

    expect(res.status).toBe(200);
    expect(res.body.object).toBe("list");
    expect(res.body.data[0].object).toBe("embedding");
    expect(res.body.model).toBe("text-embedding-3-small");
    expect(res.body.provider).toBe("openai");
    expect(res.body.usage.total_tokens).toBe(7);
  });
});

describe("GET /ping", () => {
  it("returns pong", async () => {
    const res = await request(app).get("/ping");
    expect(res.status).toBe(200);
    expect(res.text).toBe("pong");
  });
});

// --- Authentication ---

describe("Authentication", () => {
  it("rejects requests without auth header", async () => {
    const res = await request(app).get("/providers");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("rejects requests with wrong token", async () => {
    const res = await request(app)
      .get("/providers")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("allows requests with correct token", async () => {
    const res = await request(app).get("/providers").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.providers).toBeInstanceOf(Array);
  });
});

// --- POST /v1/chat/completions ---

describe("POST /v1/chat/completions", () => {
  beforeEach(() => {
    mockedComplete.mockReset();
    mockedComplete.mockResolvedValue({
      content: "Hello from mock",
      provider: "openai",
      model: "gpt-4o-mini",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      latencyMs: 42,
    });
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/v1/chat/completions")
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(401);
  });

  it("returns 400 for empty messages array", async () => {
    const res = await request(app)
      .post("/v1/chat/completions")
      .set(AUTH)
      .send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it("returns OpenAI-compatible response on success", async () => {
    const res = await request(app)
      .post("/v1/chat/completions")
      .set(AUTH)
      .send({ messages: [{ role: "user", content: "hello" }] });
    expect(res.status).toBe(200);
    expect(res.body.object).toBe("chat.completion");
    expect(res.body.id).toMatch(/^chatcmpl-/);
    expect(res.body.choices[0].message.content).toBe("Hello from mock");
    expect(res.body.choices[0].message.role).toBe("assistant");
    expect(res.body.usage.total_tokens).toBe(15);
    expect(res.body.provider).toBe("openai");
  });

  it("returns 500 when all providers fail", async () => {
    mockedComplete.mockRejectedValue(new Error("All providers failed"));
    const res = await request(app)
      .post("/v1/chat/completions")
      .set(AUTH)
      .send({ messages: [{ role: "user", content: "hello" }] });
    expect(res.status).toBe(500);
    expect(res.body.error.type).toBe("ai_error");
    expect(res.body.error.message).toBe("AI completion failed");
    expect(res.body.error.code).toBe("ai.completion_failed");
  });

  it("returns 400 when routing rejects a provider or model", async () => {
    mockedComplete.mockRejectedValue(
      new CompletionRoutingError("Unsupported provider: bad-vendor"),
    );

    const res = await request(app)
      .post("/v1/chat/completions")
      .set(AUTH)
      .send({ messages: [{ role: "user", content: "hello" }], provider: "bad-vendor" });

    expect(res.status).toBe(400);
    expect(res.body.error.type).toBe("routing_error");
    expect(res.body.error.code).toBe("routing.unsupported_provider");
  });
});

// --- POST /complete ---

describe("POST /complete", () => {
  beforeEach(() => {
    mockedComplete.mockReset();
    mockedComplete.mockResolvedValue({
      content: "Simple response",
      provider: "openai",
      model: "gpt-4o-mini",
      usage: { promptTokens: 8, completionTokens: 3, totalTokens: 11 },
      latencyMs: 30,
    });
  });

  it("returns 400 for missing prompt", async () => {
    const res = await request(app)
      .post("/complete")
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns simple completion response", async () => {
    const res = await request(app)
      .post("/complete")
      .set(AUTH)
      .send({ prompt: "hello" });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("Simple response");
    expect(res.body.provider).toBe("openai");
    expect(res.body.model).toBe("gpt-4o-mini");
    expect(res.body.usage.totalTokens).toBe(11);
  });
});
