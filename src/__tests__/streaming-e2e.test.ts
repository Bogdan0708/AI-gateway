import http from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "../types";

const TEST_KEY = "test-e2e-streaming-key";

const mockStreamChunks: StreamChunk[] = [
  { content: "Hello", provider: "openai", model: "gpt-4o-mini" },
  { content: " world", provider: "openai", model: "gpt-4o-mini" },
  {
    content: "!",
    provider: "openai",
    model: "gpt-4o-mini",
    finishReason: "stop",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  },
];

function createMockStream(chunks: StreamChunk[]): ReadableStream<StreamChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

let server: http.Server;
let baseUrl: string;

describe("E2E streaming over real HTTP", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GATEWAY_MASTER_KEY = TEST_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GATEWAY_MASTER_KEY;
  });

  beforeAll(async () => {
    process.env.GATEWAY_MASTER_KEY = TEST_KEY;

    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
    };
    mockLog.child.mockReturnValue(mockLog);

    vi.doMock("../lib/logger", () => ({
      logger: mockLog,
      httpLogger: (_req: unknown, _res: unknown, next: () => void) => next(),
    }));

    vi.doMock("../providers", () => ({
      checkProviderReadiness: vi.fn(),
      complete: vi.fn(),
      completeStream: vi.fn(() => createMockStream(mockStreamChunks)),
      CompletionRoutingError: class extends Error {
        statusCode = 400;
        code = "routing.unsupported_provider";
      },
      embed: vi.fn(),
      listProviders: vi.fn(() => []),
    }));

    vi.doMock("../lib/tenant-policy", () => ({
      enforceTenantPolicy: vi.fn((input: Record<string, unknown>) => input),
      filterProvidersForTenant: vi.fn((input: { providers: unknown[] }) => input.providers),
      resolveTenantId: vi.fn(() => undefined),
      TenantPolicyError: class extends Error {
        statusCode = 403;
        code = "tenant.forbidden";
      },
    }));

    vi.doMock("../lib/concurrency", () => ({
      ConcurrencyLimitError: class extends Error {
        statusCode = 429;
        code = "concurrency.limit";
      },
      getInflightCounts: vi.fn(() => ({ global: 0 })),
      withConcurrencyLimit: vi.fn(
        (_tenantId: string | undefined, fn: () => Promise<unknown>) => fn(),
      ),
    }));

    const { app } = await import("../index");

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("streams SSE chunks incrementally over real HTTP", async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_KEY}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const body = res.body;
    expect(body).toBeTruthy();

    const reader = body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    // Parse SSE events
    const events = fullText
      .split("\n\n")
      .map((block) => block.trim())
      .filter(Boolean);

    // Should have 3 data chunks + 1 [DONE] sentinel
    const dataEvents = events.filter((e) => e.startsWith("data: ") && e !== "data: [DONE]");
    const doneEvent = events.find((e) => e === "data: [DONE]");

    expect(dataEvents).toHaveLength(3);
    expect(doneEvent).toBeDefined();

    // Verify first chunk
    const first = JSON.parse(dataEvents[0].replace("data: ", ""));
    expect(first.object).toBe("chat.completion.chunk");
    expect(first.choices[0].delta.content).toBe("Hello");
    expect(first.id).toMatch(/^chatcmpl-/);

    // Verify second chunk
    const second = JSON.parse(dataEvents[1].replace("data: ", ""));
    expect(second.choices[0].delta.content).toBe(" world");

    // Verify final chunk has finish_reason and usage
    const last = JSON.parse(dataEvents[2].replace("data: ", ""));
    expect(last.choices[0].delta.content).toBe("!");
    expect(last.choices[0].finish_reason).toBe("stop");
    expect(last.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it("returns proper headers for SSE responses", async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_KEY}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "test" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("connection")).toBe("keep-alive");

    // Consume the body to avoid connection leak
    await res.text();
  });

  it("rejects streaming requests without auth", async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(401);
  });
});
