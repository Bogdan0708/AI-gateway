import { describe, expect, it } from "vitest";
import { estimateChatCost } from "../lib/estimate";

describe("estimateChatCost", () => {
  it("estimates prompt, completion, and total tokens", () => {
    const result = estimateChatCost({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Write a short greeting." },
      ],
      provider: "openai",
      model: "gpt-4o-mini",
      maxTokens: 128,
    });

    expect(result.promptTokens).toBeGreaterThan(0);
    expect(result.completionTokens).toBe(128);
    expect(result.totalTokens).toBe(result.promptTokens + 128);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.costCents).toBeGreaterThan(0);
  });

  it("uses default completion tokens when maxTokens is omitted", () => {
    const result = estimateChatCost({
      messages: [{ role: "user", content: "Hello" }],
      provider: "claude",
      model: "claude-opus-4-1",
    });

    expect(result.completionTokens).toBe(256);
    expect(result.totalTokens).toBe(result.promptTokens + 256);
  });
});
