import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.GATEWAY_MASTER_KEY = "test-key-for-metrics";

vi.mock("../providers", () => ({
  listProviders: () => [
    { id: "openai", enabled: true, defaultModel: "gpt-4o-mini", models: ["gpt-4o-mini"] },
  ],
  checkProviderReadiness: async () => [],
  complete: async () => ({
    content: "test",
    provider: "openai",
    model: "gpt-4o-mini",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    latencyMs: 42,
  }),
  completeStream: () => {
    throw new Error("not implemented");
  },
  embed: async () => ({
    embeddings: [[0.1]],
    provider: "openai",
    model: "text-embedding-3-small",
    usage: { promptTokens: 5, totalTokens: 5 },
    latencyMs: 10,
  }),
  CompletionRoutingError: class extends Error {
    statusCode = 400;
    code = "test";
  },
}));

import { app } from "../index";
import { metricsRegistry } from "../lib/metrics";

afterEach(async () => {
  metricsRegistry.resetMetrics();
});

describe("GET /metrics", () => {
  it("returns Prometheus text format without authentication", async () => {
    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("# HELP");
    expect(res.text).toContain("# TYPE");
  });

  it("includes default Node.js metrics", async () => {
    const res = await request(app).get("/metrics");

    expect(res.text).toContain("nodejs_");
    expect(res.text).toContain("process_");
  });

  it("includes custom gateway metric definitions", async () => {
    const res = await request(app).get("/metrics");

    expect(res.text).toContain("http_requests_total");
    expect(res.text).toContain("http_request_duration_ms");
    expect(res.text).toContain("ai_requests_total");
    expect(res.text).toContain("ai_request_duration_ms");
    expect(res.text).toContain("ai_tokens_total");
  });

  it("records HTTP request metrics after a request", async () => {
    await request(app).get("/health");

    const res = await request(app).get("/metrics");

    expect(res.text).toContain('http_requests_total{method="GET",path="/health",status_code="200"}');
  });

  it("is not rate-limited", async () => {
    // /metrics should respond 200 even under heavy polling
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(app).get("/metrics")),
    );
    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });
});
