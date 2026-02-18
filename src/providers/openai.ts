import OpenAI from 'openai';
import { CompletionRequest, CompletionResponse, ProviderConfig } from '../types';

const MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-5'] as const;
const TIMEOUT_MS = 30_000;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return client;
}

export async function complete(
  request: CompletionRequest & { model: string; maxTokens: number; temperature: number }
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
        temperature: request.temperature
      },
      { signal: controller.signal }
    );

    return {
      content: response.choices[0]?.message?.content || '',
      provider: 'openai',
      model: request.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0
      },
      latencyMs: Date.now() - start
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const openaiProvider: ProviderConfig = {
  name: 'openai',
  enabled: Boolean(process.env.OPENAI_API_KEY),
  defaultModel: 'gpt-4o-mini',
  models: [...MODELS],
  complete
};
