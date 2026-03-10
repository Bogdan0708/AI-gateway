import Groq from "groq-sdk";
import { probeUrl } from "../lib/readiness";
import {
  CompletionRequest,
  CompletionResponse,
  ProviderConfig,
} from "../types";

const MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
] as const;
const TIMEOUT_MS = 15_000;

let client: Groq | null = null;

function getClient(): Groq {
  if (!client) {
    client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  return client;
}

export async function complete(
  request: CompletionRequest & {
    model: string;
    maxTokens: number;
    temperature: number;
  },
): Promise<CompletionResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();

  try {
    const response = await getClient().chat.completions.create(
      {
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      },
      { signal: controller.signal },
    );

    return {
      content: response.choices[0]?.message?.content || "",
      provider: "groq",
      model: request.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const groqProvider: ProviderConfig = {
  name: "groq",
  enabled: Boolean(process.env.GROQ_API_KEY),
  defaultModel: "llama-3.3-70b-versatile",
  models: [...MODELS],
  checkReadiness: () => probeUrl("https://api.groq.com/openai/v1/models"),
  complete,
};
