import Anthropic from "@anthropic-ai/sdk";
import { probeUrl } from "../lib/readiness";
import {
  CompletionRequest,
  CompletionResponse,
  ProviderConfig,
} from "../types";

const MODELS = [
  "claude-sonnet-4-20250514",
  "claude-3-5-sonnet-20241022",
  "claude-3-haiku-20240307",
] as const;
const TIMEOUT_MS = 30_000;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  return client;
}

function splitSystemMessage(messages: CompletionRequest["messages"]): {
  system: string;
  chat: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const chat = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
    }));

  return { system, chat };
}

export async function complete(
  request: CompletionRequest & {
    model: string;
    maxTokens: number;
    temperature: number;
  },
): Promise<CompletionResponse> {
  const { system, chat } = splitSystemMessage(request.messages);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();

  try {
    const response = await getClient().messages.create(
      {
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: system || undefined,
        messages: chat,
      },
      { signal: controller.signal },
    );

    const textBlock = response.content.find((block) => block.type === "text");
    const promptTokens = response.usage.input_tokens || 0;
    const completionTokens = response.usage.output_tokens || 0;

    return {
      content: textBlock?.type === "text" ? textBlock.text : "",
      provider: "claude",
      model: request.model,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const claudeProvider: ProviderConfig = {
  name: "claude",
  enabled: Boolean(process.env.ANTHROPIC_API_KEY),
  defaultModel: "claude-sonnet-4-20250514",
  models: [...MODELS],
  checkReadiness: () => probeUrl("https://api.anthropic.com"),
  complete,
};
