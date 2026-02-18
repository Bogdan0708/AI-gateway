import { logger } from '../lib/logger';
import { CompletionRequest, CompletionResponse, ProviderConfig, ProviderName } from '../types';
import { claudeProvider } from './claude';
import { geminiProvider } from './gemini';
import { groqProvider } from './groq';
import { openaiProvider } from './openai';
import { perplexityProvider } from './perplexity';
import { xaiProvider } from './xai';

const providerRegistry: Record<ProviderName, ProviderConfig> = {
  openai: openaiProvider,
  claude: claudeProvider,
  gemini: geminiProvider,
  xai: xaiProvider,
  groq: groqProvider,
  perplexity: perplexityProvider
};

const fallbackChain: ProviderName[] = ['openai', 'claude', 'gemini', 'xai', 'groq', 'perplexity'];

export const providers = fallbackChain.map((providerName) => providerRegistry[providerName]);

function resolveProviderOrder(requestedProvider?: string): ProviderConfig[] {
  const enabledProviders = fallbackChain
    .map((providerName) => providerRegistry[providerName])
    .filter((provider) => provider.enabled);

  if (!requestedProvider) {
    return enabledProviders;
  }

  const requested = providerRegistry[requestedProvider as ProviderName];
  if (!requested || !requested.enabled) {
    return enabledProviders;
  }

  return [requested, ...enabledProviders.filter((provider) => provider.name !== requested.name)];
}

export function listProviders(): Array<{
  id: ProviderName;
  enabled: boolean;
  defaultModel: string;
  models: string[];
}> {
  return fallbackChain.map((providerName) => {
    const provider = providerRegistry[providerName];
    return {
      id: provider.name,
      enabled: provider.enabled,
      defaultModel: provider.defaultModel,
      models: provider.models
    };
  });
}

export async function complete(request: CompletionRequest): Promise<CompletionResponse> {
  const providersInOrder = resolveProviderOrder(request.provider);

  if (providersInOrder.length === 0) {
    throw new Error('No AI providers configured');
  }

  const maxTokens = request.maxTokens ?? 2048;
  const temperature = request.temperature ?? 0.7;

  let lastError: Error | null = null;

  for (const provider of providersInOrder) {
    const model = request.model && provider.models.includes(request.model)
      ? request.model
      : provider.defaultModel;

    try {
      return await provider.complete({
        ...request,
        model,
        maxTokens,
        temperature
      });
    } catch (error) {
      const providerError = error instanceof Error ? error : new Error('Unknown provider error');
      logger.warn(
        {
          provider: provider.name,
          model,
          error: providerError.message
        },
        'provider completion failed, trying fallback'
      );
      lastError = providerError;
    }
  }

  throw lastError || new Error('All providers failed');
}
