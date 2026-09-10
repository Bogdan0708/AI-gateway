import { CompletionMessage, ProviderName } from "../types";

type PriceConfig = {
  inputPer1KUsd: number;
  outputPer1KUsd: number;
};

const DEFAULT_OUTPUT_TOKENS = 256;
const CHARS_PER_TOKEN = 4;
const TOKENS_PER_MESSAGE_OVERHEAD = 4;
const TOKENS_PRIMER_OVERHEAD = 2;

const DEFAULT_PROVIDER_PRICING: Record<ProviderName, PriceConfig> = {
  openai: { inputPer1KUsd: 0.002, outputPer1KUsd: 0.008 },
  claude: { inputPer1KUsd: 0.003, outputPer1KUsd: 0.015 },
  gemini: { inputPer1KUsd: 0.0015, outputPer1KUsd: 0.006 },
  xai: { inputPer1KUsd: 0.003, outputPer1KUsd: 0.015 },
  groq: { inputPer1KUsd: 0.0008, outputPer1KUsd: 0.0024 },
  perplexity: { inputPer1KUsd: 0.001, outputPer1KUsd: 0.001 },
};

const MODEL_PRICE_OVERRIDES: Record<string, PriceConfig> = {
  "gpt-4o": { inputPer1KUsd: 0.005, outputPer1KUsd: 0.015 },
  "gpt-4o-mini": { inputPer1KUsd: 0.00015, outputPer1KUsd: 0.0006 },
};

function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

function getPricing(provider: ProviderName, model: string): PriceConfig {
  return MODEL_PRICE_OVERRIDES[model] ?? DEFAULT_PROVIDER_PRICING[provider];
}

export function estimateChatCost(input: {
  messages: CompletionMessage[];
  provider: ProviderName;
  model: string;
  maxTokens?: number;
}) {
  const promptTokens =
    input.messages.reduce(
      (sum, message) =>
        sum +
        TOKENS_PER_MESSAGE_OVERHEAD +
        estimateTokensFromText(message.role) +
        estimateTokensFromText(message.content),
      0,
    ) + TOKENS_PRIMER_OVERHEAD;
  const completionTokens = input.maxTokens ?? DEFAULT_OUTPUT_TOKENS;
  const totalTokens = promptTokens + completionTokens;

  const pricing = getPricing(input.provider, input.model);
  const costUsd =
    (promptTokens / 1000) * pricing.inputPer1KUsd +
    (completionTokens / 1000) * pricing.outputPer1KUsd;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: Number(costUsd.toFixed(6)),
    costCents: Number((costUsd * 100).toFixed(4)),
    inputCostPer1KUsd: pricing.inputPer1KUsd,
    outputCostPer1KUsd: pricing.outputPer1KUsd,
  };
}
