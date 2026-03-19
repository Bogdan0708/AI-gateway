import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "../types";

const mockStreamChunks: StreamChunk[] = [
  { content: "Hello", provider: "openai", model: "gpt-4o-mini" },
  { content: " world", provider: "openai", model: "gpt-4o-mini" },
  {
    content: "",
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

async function loadProvidersModule(overrides?: {
  openai?: {
    enabled?: boolean;
    stream?: ReturnType<typeof vi.fn>;
  };
}) {
  vi.resetModules();

  const openaiStream =
    overrides?.openai?.stream ?? vi.fn(() => createMockStream(mockStreamChunks));

  vi.doMock("../lib/logger", () => ({
    logger: {
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
    },
  }));

  vi.doMock("../lib/base-prompts", () => ({
    getSystemPromptForModel: vi.fn(() => ""),
  }));

  vi.doMock("../providers/openai", () => ({
    openaiProvider: {
      name: "openai",
      enabled: overrides?.openai?.enabled ?? true,
      defaultModel: "gpt-4o-mini",
      models: ["gpt-4o-mini", "gpt-4o"],
      complete: vi.fn(),
      stream: openaiStream,
    },
  }));

  vi.doMock("../providers/claude", () => ({
    claudeProvider: {
      name: "claude",
      enabled: false,
      defaultModel: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
      complete: vi.fn(),
    },
  }));

  vi.doMock("../providers/gemini", () => ({
    geminiProvider: {
      name: "gemini",
      enabled: false,
      defaultModel: "gemini-2.0-flash",
      models: ["gemini-2.0-flash"],
      complete: vi.fn(),
    },
  }));

  vi.doMock("../providers/xai", () => ({
    xaiProvider: {
      name: "xai",
      enabled: false,
      defaultModel: "grok-3",
      models: ["grok-3"],
      complete: vi.fn(),
    },
  }));

  vi.doMock("../providers/groq", () => ({
    groqProvider: {
      name: "groq",
      enabled: false,
      defaultModel: "llama-3.3-70b-versatile",
      models: ["llama-3.3-70b-versatile"],
      complete: vi.fn(),
    },
  }));

  vi.doMock("../providers/perplexity", () => ({
    perplexityProvider: {
      name: "perplexity",
      enabled: false,
      defaultModel: "sonar-pro",
      models: ["sonar-pro"],
      complete: vi.fn(),
    },
  }));

  return await import("../providers/index");
}

describe("completeStream", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exported as a function", async () => {
    const { completeStream } = await loadProvidersModule();
    expect(completeStream).toBeDefined();
    expect(typeof completeStream).toBe("function");
  });

  it("returns a ReadableStream", async () => {
    const { completeStream } = await loadProvidersModule();

    const stream = completeStream({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(stream).toBeInstanceOf(ReadableStream);
  });

  it("yields all chunks from the provider stream", async () => {
    const { completeStream } = await loadProvidersModule();

    const stream = completeStream({
      messages: [{ role: "user", content: "Hello" }],
    });

    const reader = stream.getReader();
    const chunks: StreamChunk[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toBe("Hello");
    expect(chunks[1].content).toBe(" world");
    expect(chunks[2].finishReason).toBe("stop");
    expect(chunks[2].usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("throws when no streaming-capable provider is available", async () => {
    vi.resetModules();
    vi.doMock("../lib/logger", () => ({
      logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
    }));
    vi.doMock("../lib/base-prompts", () => ({
      getSystemPromptForModel: vi.fn(() => ""),
    }));
    vi.doMock("../providers/openai", () => ({
      openaiProvider: {
        name: "openai",
        enabled: true,
        defaultModel: "gpt-4o-mini",
        models: ["gpt-4o-mini"],
        complete: vi.fn(),
      },
    }));
    vi.doMock("../providers/claude", () => ({
      claudeProvider: {
        name: "claude",
        enabled: false,
        defaultModel: "claude-sonnet-4-20250514",
        models: [],
        complete: vi.fn(),
      },
    }));
    vi.doMock("../providers/gemini", () => ({
      geminiProvider: {
        name: "gemini",
        enabled: false,
        defaultModel: "gemini-2.0-flash",
        models: [],
        complete: vi.fn(),
      },
    }));
    vi.doMock("../providers/xai", () => ({
      xaiProvider: {
        name: "xai",
        enabled: false,
        defaultModel: "grok-3",
        models: [],
        complete: vi.fn(),
      },
    }));
    vi.doMock("../providers/groq", () => ({
      groqProvider: {
        name: "groq",
        enabled: false,
        defaultModel: "llama-3.3-70b-versatile",
        models: [],
        complete: vi.fn(),
      },
    }));
    vi.doMock("../providers/perplexity", () => ({
      perplexityProvider: {
        name: "perplexity",
        enabled: false,
        defaultModel: "sonar-pro",
        models: [],
        complete: vi.fn(),
      },
    }));

    const mod = await import("../providers/index");

    expect(() =>
      mod.completeStream({
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).toThrow("No streaming-capable providers available");
  });
});

describe("SSE streaming route", () => {
  const TEST_KEY = "test-gateway-key-streaming";

  beforeEach(() => {
    vi.resetModules();
    process.env.GATEWAY_MASTER_KEY = TEST_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GATEWAY_MASTER_KEY;
  });

  function mockSSEDeps() {
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
  }

  it("returns SSE content-type for stream: true requests", async () => {
    mockSSEDeps();

    const request = (await import("supertest")).default;
    const { app } = await import("../index");

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .send({
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toContain("data: ");
    expect(res.text).toContain('"chat.completion.chunk"');
    expect(res.text).toContain("data: [DONE]");
  });

  it("streams multiple SSE chunks with correct format", async () => {
    mockSSEDeps();

    const request = (await import("supertest")).default;
    const { app } = await import("../index");

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .send({
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      });

    const lines = res.text
      .split("\n\n")
      .filter((line: string) => line.startsWith("data: ") && line !== "data: [DONE]");
    expect(lines.length).toBe(3);

    const firstChunk = JSON.parse(lines[0].replace("data: ", ""));
    expect(firstChunk.object).toBe("chat.completion.chunk");
    expect(firstChunk.choices[0].delta.content).toBe("Hello");
    expect(firstChunk.id).toMatch(/^chatcmpl-/);

    const lastChunk = JSON.parse(lines[2].replace("data: ", ""));
    expect(lastChunk.choices[0].finish_reason).toBe("stop");
    expect(lastChunk.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });
});
