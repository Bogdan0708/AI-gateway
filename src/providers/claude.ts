import Anthropic from "@anthropic-ai/sdk";
import { probeUrl } from "../lib/readiness";
import {
  CompletionRequest,
  CompletionResponse,
  CompletionStream,
  ProviderConfig,
} from "../types";

const MODELS = [
  "claude-4.6-opus",
  "claude-4.6-sonnet",
  "claude-sonnet-4-20250514",
] as const;
const TIMEOUT_MS = 15_000;

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

const STREAM_TIMEOUT_MS = 120_000;

export function stream(
  request: CompletionRequest & {
    model: string;
    maxTokens: number;
    temperature: number;
  },
): CompletionStream {
  const { system, chat } = splitSystemMessage(request.messages);

  return new ReadableStream({
    async start(controller) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), STREAM_TIMEOUT_MS);

      try {
        const response = getClient().messages.stream(
          {
            model: request.model,
            max_tokens: request.maxTokens,
            temperature: request.temperature,
            system: system || undefined,
            messages: chat,
          },
          { signal: abortController.signal },
        );

        let promptTokens = 0;
        let completionTokens = 0;

        for await (const event of response) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue({
              content: event.delta.text,
              provider: "claude",
              model: request.model,
            });
          } else if (event.type === "message_delta") {
            completionTokens = event.usage?.output_tokens ?? completionTokens;
            controller.enqueue({
              content: "",
              provider: "claude",
              model: request.model,
              finishReason: event.delta.stop_reason ?? "end_turn",
              usage: {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
              },
            });
          } else if (event.type === "message_start") {
            promptTokens = event.message.usage?.input_tokens ?? 0;
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

export const claudeProvider: ProviderConfig = {
  name: "claude",
  enabled: Boolean(process.env.ANTHROPIC_API_KEY),
  defaultModel: "claude-4.6-opus",
  models: [...MODELS],
  checkReadiness: () =>
    probeUrl("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
    }),
  complete,
  stream,
};
