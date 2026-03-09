import { afterEach, describe, expect, it, vi } from "vitest";

async function loadProvidersModule(overrides?: {
  openai?: { enabled?: boolean; ready?: boolean; reason?: string };
  claude?: { enabled?: boolean; ready?: boolean; reason?: string };
}) {
  vi.resetModules();

  vi.doMock("../providers/openai", () => ({
    openaiProvider: {
      name: "openai",
      enabled: overrides?.openai?.enabled ?? true,
      defaultModel: "gpt-4o-mini",
      models: ["gpt-4o-mini"],
      checkReadiness: vi.fn().mockResolvedValue({
        ready: overrides?.openai?.ready ?? true,
        reason: overrides?.openai?.reason ?? "reachable (200)",
      }),
      complete: vi.fn(),
    },
  }));

  vi.doMock("../providers/claude", () => ({
    claudeProvider: {
      name: "claude",
      enabled: overrides?.claude?.enabled ?? false,
      defaultModel: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
      checkReadiness: vi.fn().mockResolvedValue({
        ready: overrides?.claude?.ready ?? false,
        reason: overrides?.claude?.reason ?? "probe timed out",
      }),
      complete: vi.fn(),
    },
  }));

  vi.doMock("../providers/gemini", () => ({
    geminiProvider: {
      name: "gemini",
      enabled: false,
      defaultModel: "gemini-2.0-flash",
      models: ["gemini-2.0-flash"],
      checkReadiness: vi.fn(),
      complete: vi.fn(),
    },
  }));

  vi.doMock("../providers/xai", () => ({
    xaiProvider: {
      name: "xai",
      enabled: false,
      defaultModel: "grok-3",
      models: ["grok-3"],
      checkReadiness: vi.fn(),
      complete: vi.fn(),
    },
  }));

  vi.doMock("../providers/groq", () => ({
    groqProvider: {
      name: "groq",
      enabled: false,
      defaultModel: "llama-3.3-70b-versatile",
      models: ["llama-3.3-70b-versatile"],
      checkReadiness: vi.fn(),
      complete: vi.fn(),
    },
  }));

  vi.doMock("../providers/perplexity", () => ({
    perplexityProvider: {
      name: "perplexity",
      enabled: false,
      defaultModel: "sonar",
      models: ["sonar"],
      checkReadiness: vi.fn(),
      complete: vi.fn(),
    },
  }));

  return import("../providers");
}

afterEach(() => {
  vi.unmock("../providers/openai");
  vi.unmock("../providers/claude");
  vi.unmock("../providers/gemini");
  vi.unmock("../providers/xai");
  vi.unmock("../providers/groq");
  vi.unmock("../providers/perplexity");
});

describe("provider readiness", () => {
  it("reports configured providers and probe results", async () => {
    const { checkProviderReadiness } = await loadProvidersModule({
      openai: { enabled: true, ready: true, reason: "reachable (200)" },
      claude: { enabled: true, ready: false, reason: "probe timed out" },
    });

    const readiness = await checkProviderReadiness();

    expect(readiness).toEqual(
      expect.arrayContaining([
        {
          id: "openai",
          enabled: true,
          ready: true,
          reason: "reachable (200)",
        },
        {
          id: "claude",
          enabled: true,
          ready: false,
          reason: "probe timed out",
        },
      ]),
    );
  });

  it("marks disabled providers as not configured", async () => {
    const { checkProviderReadiness } = await loadProvidersModule({
      openai: { enabled: false },
    });

    const readiness = await checkProviderReadiness();
    expect(readiness[0]).toEqual({
      id: "openai",
      enabled: false,
      ready: false,
      reason: "provider not configured",
    });
  });
});
