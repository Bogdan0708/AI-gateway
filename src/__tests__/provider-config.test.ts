import { afterEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class Anthropic {
      messages = {
        create: createMock,
      };
    },
  };
});

describe("provider configuration", () => {
  afterEach(() => {
    createMock.mockReset();
  });

  it("maps the Claude compatibility alias to the live Anthropic model", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 12,
        output_tokens: 4,
      },
    });

    const { complete, claudeProvider } = await import("../providers/claude");

    const response = await complete({
      model: "claude-4.6-sonnet",
      maxTokens: 32,
      temperature: 0,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(claudeProvider.defaultModel).toBe("claude-opus-4-1");
    expect(claudeProvider.models).toEqual([
      "claude-opus-4-1",
      "claude-opus-4-0",
      "claude-sonnet-4-0",
      "claude-3-7-sonnet-latest",
      "claude-3-5-haiku-latest",
    ]);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-0",
      }),
      expect.any(Object),
    );
    expect(response.model).toBe("claude-4.6-sonnet");
  });

  it("exposes the official OpenAI and Gemini fallback order", async () => {
    const { openaiProvider } = await import("../providers/openai");
    const { geminiProvider } = await import("../providers/gemini");

    expect(openaiProvider.defaultModel).toBe("gpt-5.2");
    expect(openaiProvider.models).toEqual([
      "gpt-5.2",
      "gpt-5",
      "gpt-5-mini",
      "gpt-4.1-mini",
      "gpt-4o",
      "gpt-4o-mini",
    ]);
    expect(geminiProvider.defaultModel).toBe("gemini-3-pro-preview");
    expect(geminiProvider.models).toEqual([
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ]);
  });
});
