import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeResponse = {
  content: "ok",
  provider: "openai" as const,
  model: "gpt-4o-mini",
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  latencyMs: 1,
};

const originalMaxFallbackAttempts = process.env.MAX_FALLBACK_ATTEMPTS;

async function loadProvidersModule(overrides?: {
  openai?: { enabled?: boolean; complete?: ReturnType<typeof vi.fn> };
  claude?: { enabled?: boolean; complete?: ReturnType<typeof vi.fn> };
  gemini?: { enabled?: boolean; complete?: ReturnType<typeof vi.fn> };
  xai?: { enabled?: boolean; complete?: ReturnType<typeof vi.fn> };
}) {
  vi.resetModules();
  const openaiComplete =
    overrides?.openai?.complete ?? vi.fn().mockResolvedValue(completeResponse);
  const claudeComplete =
    overrides?.claude?.complete ??
    vi.fn().mockResolvedValue({
      ...completeResponse,
      provider: "claude" as const,
      model: "claude-sonnet-4-20250514",
    });
  const geminiComplete =
    overrides?.gemini?.complete ??
    vi.fn().mockResolvedValue({
      ...completeResponse,
      provider: "gemini" as const,
      model: "gemini-2.0-flash",
    });
  const xaiComplete =
    overrides?.xai?.complete ??
    vi.fn().mockResolvedValue({
      ...completeResponse,
      provider: "xai" as const,
      model: "grok-3",
    });

  vi.doMock("../lib/logger", () => ({
    logger: {
      warn: vi.fn(),
    },
  }));

  vi.doMock("../providers/openai", () => ({
    openaiProvider: {
      name: "openai",
      enabled: overrides?.openai?.enabled ?? true,
      defaultModel: "gpt-4o-mini",
      models: ["gpt-4o-mini", "gpt-4o"],
      complete: openaiComplete,
    },
  }));

  vi.doMock("../providers/claude", () => ({
    claudeProvider: {
      name: "claude",
      enabled: overrides?.claude?.enabled ?? true,
      defaultModel: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
      complete: claudeComplete,
    },
  }));

  vi.doMock("../providers/gemini", () => ({
    geminiProvider: {
      name: "gemini",
      enabled: overrides?.gemini?.enabled ?? false,
      defaultModel: "gemini-2.0-flash",
      models: ["gemini-2.0-flash"],
      complete: geminiComplete,
    },
  }));

  vi.doMock("../providers/xai", () => ({
    xaiProvider: {
      name: "xai",
      enabled: overrides?.xai?.enabled ?? false,
      defaultModel: "grok-3",
      models: ["grok-3"],
      complete: xaiComplete,
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
      defaultModel: "sonar",
      models: ["sonar"],
      complete: vi.fn(),
    },
  }));

  const module = await import("../providers");
  return {
    ...module,
    openaiComplete,
    claudeComplete,
    geminiComplete,
    xaiComplete,
  };
}

describe("provider routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalMaxFallbackAttempts === undefined) {
      delete process.env.MAX_FALLBACK_ATTEMPTS;
    } else {
      process.env.MAX_FALLBACK_ATTEMPTS = originalMaxFallbackAttempts;
    }

    vi.unmock("../lib/logger");
    vi.unmock("../providers/openai");
    vi.unmock("../providers/claude");
    vi.unmock("../providers/gemini");
    vi.unmock("../providers/xai");
    vi.unmock("../providers/groq");
    vi.unmock("../providers/perplexity");
  });

  it("rejects an unknown provider instead of silently rerouting", async () => {
    const { complete } = await loadProvidersModule();

    await expect(
      complete({
        provider: "unknown",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
        name: "CompletionRoutingError",
        statusCode: 400,
        code: "routing.unsupported_provider",
        message: "Unsupported provider: unknown",
      },
    );
  });

  it("rejects an unsupported model for a requested provider", async () => {
    const { complete } = await loadProvidersModule();

    await expect(
      complete({
        provider: "claude",
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
        name: "CompletionRoutingError",
        statusCode: 400,
        code: "routing.unsupported_model",
        message: "Model gpt-4o-mini is not available for provider claude",
      },
    );
  });

  it("falls back only when explicitly enabled", async () => {
    const { complete, openaiComplete, claudeComplete } = await loadProvidersModule();
    openaiComplete.mockRejectedValue(new Error("OpenAI unavailable"));

    await expect(
      complete({
        provider: "openai",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow("OpenAI unavailable");

    const response = await complete({
      provider: "openai",
      allowFallback: true,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(response.provider).toBe("claude");
    expect(claudeComplete).toHaveBeenCalledTimes(1);
  });

  it("does not fall back on non-retryable provider 4xx errors", async () => {
    const error = Object.assign(new Error("invalid request"), { status: 400 });
    const { complete, openaiComplete, claudeComplete } = await loadProvidersModule();
    openaiComplete.mockRejectedValue(error);

    await expect(
      complete({
        provider: "openai",
        allowFallback: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toBe(error);

    expect(claudeComplete).not.toHaveBeenCalled();
  });

  it("caps fallback attempts to the configured maximum", async () => {
    process.env.MAX_FALLBACK_ATTEMPTS = "2";
    const { complete, openaiComplete, claudeComplete, geminiComplete } =
      await loadProvidersModule({
        gemini: { enabled: true },
      });
    openaiComplete.mockRejectedValue(new Error("openai down"));
    claudeComplete.mockRejectedValue(new Error("claude down"));

    await expect(
      complete({
        allowFallback: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow("claude down");

    expect(openaiComplete).toHaveBeenCalledTimes(1);
    expect(claudeComplete).toHaveBeenCalledTimes(1);
    expect(geminiComplete).not.toHaveBeenCalled();
  });

  it("treats provider aliases passed as model values as provider selection hints", async () => {
    const { complete, openaiComplete } = await loadProvidersModule();

    await complete({
      provider: "openai",
      model: "openai",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(openaiComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4o-mini",
      }),
    );
  });
});
