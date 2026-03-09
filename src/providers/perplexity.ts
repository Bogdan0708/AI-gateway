import {
  CompletionRequest,
  CompletionResponse,
  ProviderConfig,
} from "../types";
import { probeUrl } from "../lib/readiness";

const MODELS = ["sonar", "sonar-pro", "sonar-reasoning"] as const;
const TIMEOUT_MS = 30_000;

interface PerplexityResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
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
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Perplexity API request failed with status ${response.status}`);
    }

    const data = (await response.json()) as PerplexityResponse;

    return {
      content: data.choices?.[0]?.message?.content || "",
      provider: "perplexity",
      model: request.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const perplexityProvider: ProviderConfig = {
  name: "perplexity",
  enabled: Boolean(process.env.PERPLEXITY_API_KEY),
  defaultModel: "sonar",
  models: [...MODELS],
  checkReadiness: () => probeUrl("https://api.perplexity.ai/chat/completions"),
  complete,
};
