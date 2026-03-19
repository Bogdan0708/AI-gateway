import { logger } from "../lib/logger";
import { ErrorCodes, type ErrorCode } from "../lib/error-codes";
import { sanitizeProviderError } from "../lib/provider-errors";
import { getSystemPromptForModel } from "../lib/base-prompts";
import {
  CompletionRequest,
  CompletionResponse,
  CompletionStream,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderConfig,
  ProviderName,
} from "../types";
import { claudeProvider } from "./claude";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { openaiProvider } from "./openai";
import { perplexityProvider } from "./perplexity";
import { xaiProvider } from "./xai";

const providerRegistry: Record<ProviderName, ProviderConfig> = {
  openai: openaiProvider,
  claude: claudeProvider,
  gemini: geminiProvider,
  xai: xaiProvider,
  groq: groqProvider,
  perplexity: perplexityProvider,
};

const fallbackChain: ProviderName[] = [
  "openai",
  "claude",
  "gemini",
  "xai",
  "groq",
  "perplexity",
];

const DEFAULT_MAX_FALLBACK_ATTEMPTS = 3;

const providerModelAliases: Partial<Record<ProviderName, Record<string, string>>> = {
  claude: {
    "claude-4.6-sonnet": "claude-sonnet-4-0",
  },
};

export const providers = fallbackChain.map(
  (providerName) => providerRegistry[providerName],
);

function getMaxFallbackAttempts(): number {
  const configured = Number(process.env.MAX_FALLBACK_ATTEMPTS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_FALLBACK_ATTEMPTS;
}

function getProviderErrorStatus(error: Error): number | undefined {
  const candidate = error as Error & {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };

  if (typeof candidate.status === "number") {
    return candidate.status;
  }

  if (typeof candidate.statusCode === "number") {
    return candidate.statusCode;
  }

  if (typeof candidate.response?.status === "number") {
    return candidate.response.status;
  }

  return undefined;
}

function isRetryableProviderError(error: Error): boolean {
  if (error.name === "AbortError") {
    return true;
  }

  const status = getProviderErrorStatus(error);
  if (status !== undefined) {
    return status >= 500 || [401, 403, 429].includes(status);
  }

  return true;
}

function isModelAvailabilityError(error: Error): boolean {
  const status = getProviderErrorStatus(error);
  const message = `${error.message} ${sanitizeProviderError(error)}`.toLowerCase();

  if (status !== undefined && [403, 404].includes(status)) {
    return true;
  }

  return (
    status === 400 &&
    (message.includes("model") ||
      message.includes("not_found_error") ||
      message.includes("not supported in the v1/chat/completions"))
  );
}

function getModelCandidates(input: {
  provider: ProviderConfig;
  requestedModel?: string;
  allowedModels?: string[];
}): string[] {
  const { provider, requestedModel, allowedModels } = input;

  if (requestedModel && provider.models.includes(requestedModel)) {
    return [requestedModel];
  }

  const orderedProviderModels = provider.models.filter(
    (model) => !allowedModels || allowedModels.includes(model),
  );

  if (orderedProviderModels.length > 0) {
    return orderedProviderModels;
  }

  if (!allowedModels) {
    return [provider.defaultModel];
  }

  const allowedDefault = allowedModels.find((model) => model === provider.defaultModel);
  return allowedDefault ? [allowedDefault] : [];
}

export class CompletionRoutingError extends Error {
  public readonly code: ErrorCode;

  constructor(
    message: string,
    public readonly statusCode: number = 400,
    code: ErrorCode = ErrorCodes.routingUnsupportedProvider,
  ) {
    super(message);
    this.name = "CompletionRoutingError";
    this.code = code;
  }
}

function normalizeRequestedProviderAndModel(input: {
  provider?: string;
  model?: string;
}): {
  provider?: string;
  model?: string;
} {
  if (
    input.provider &&
    input.model &&
    input.provider === input.model &&
    providerRegistry[input.provider as ProviderName]
  ) {
    return {
      provider: input.provider,
      model: undefined,
    };
  }

  const provider = input.provider as ProviderName | undefined;
  const aliasMap = provider ? providerModelAliases[provider] : undefined;
  const normalizedModel =
    input.model && aliasMap ? aliasMap[input.model] ?? input.model : input.model;

  return {
    provider: input.provider,
    model: normalizedModel,
  };
}

function resolveProviderOrder(
  requestedProvider?: string,
  requestedModel?: string,
  allowFallback = false,
  allowedProviders?: ProviderName[],
  allowedModels?: string[],
): ProviderConfig[] {
  const enabledProviders = fallbackChain
    .map((providerName) => providerRegistry[providerName])
    .filter((provider) => provider.enabled)
    .filter(
      (provider) =>
        !allowedProviders || allowedProviders.includes(provider.name),
    )
    .filter(
      (provider) =>
        !allowedModels ||
        allowedModels.some((allowedModel) => provider.models.includes(allowedModel)),
    );

  if (requestedProvider) {
    const requested = providerRegistry[requestedProvider as ProviderName];
    if (!requested) {
      throw new CompletionRoutingError(
        `Unsupported provider: ${requestedProvider}`,
        400,
        ErrorCodes.routingUnsupportedProvider,
      );
    }

    if (!requested.enabled) {
      throw new CompletionRoutingError(
        `Requested provider is not enabled: ${requestedProvider}`,
        503,
        ErrorCodes.routingProviderDisabled,
      );
    }

    if (requestedModel && !requested.models.includes(requestedModel)) {
      throw new CompletionRoutingError(
        `Model ${requestedModel} is not available for provider ${requestedProvider}`,
        400,
        ErrorCodes.routingUnsupportedModel,
      );
    }

    if (!allowFallback) {
      return [requested];
    }

    const fallbackProviders = enabledProviders.filter((provider) => provider.name !== requested.name);

    return [requested, ...fallbackProviders];
  }

  if (!requestedModel) {
    return enabledProviders;
  }

  const matchingProviders = enabledProviders.filter((provider) =>
    provider.models.includes(requestedModel),
  );

  if (matchingProviders.length === 0) {
    throw new CompletionRoutingError(
      `Unsupported model: ${requestedModel}`,
      400,
      ErrorCodes.routingUnsupportedModel,
    );
  }

  if (!allowFallback) {
    return [matchingProviders[0]];
  }

  const primaryProvider = matchingProviders[0];
  const fallbackProviders = enabledProviders.filter((provider) => provider.name !== primaryProvider.name);

  return [primaryProvider, ...fallbackProviders];
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
      models: provider.models,
    };
  });
}

export async function checkProviderReadiness(): Promise<
  Array<{
    id: ProviderName;
    enabled: boolean;
    ready: boolean;
    reason: string;
  }>
> {
  const checks = await Promise.all(
    fallbackChain.map(async (providerName) => {
      const provider = providerRegistry[providerName];

      if (!provider.enabled) {
        return {
          id: provider.name,
          enabled: false,
          ready: false,
          reason: "provider not configured",
        };
      }

      if (!provider.checkReadiness) {
        return {
          id: provider.name,
          enabled: true,
          ready: true,
          reason: "no readiness probe configured",
        };
      }

      const result = await provider.checkReadiness();
      return {
        id: provider.name,
        enabled: true,
        ready: result.ready,
        reason: result.reason ?? "probe completed",
      };
    }),
  );

  return checks;
}

export async function complete(
  request: CompletionRequest,
): Promise<CompletionResponse> {
  const normalized = normalizeRequestedProviderAndModel({
    provider: request.provider,
    model: request.model,
  });
  const providersInOrder = resolveProviderOrder(
    normalized.provider,
    normalized.model,
    request.allowFallback ?? false,
    request.allowedProviders,
    request.allowedModels,
  ).slice(0, getMaxFallbackAttempts());

  if (providersInOrder.length === 0) {
    throw new Error("No AI providers configured");
  }

  const maxTokens = request.maxTokens ?? 2048;
  const temperature = request.temperature ?? 0.7;

  let lastError: Error | null = null;

  for (const provider of providersInOrder) {
    const modelCandidates = getModelCandidates({
      provider,
      requestedModel: normalized.model,
      allowedModels: request.allowedModels,
    });

    if (modelCandidates.length === 0) {
      continue;
    }

    // Inject platform system prompt if enabled
    for (let index = 0; index < modelCandidates.length; index += 1) {
      const model = modelCandidates[index];
      const messages = [...request.messages];
      if (process.env.PLATFORM_SYSTEM_PROMPTS_ENABLED === "true") {
        const platformPrompt = getSystemPromptForModel(model);
        const existingSystemIndex = messages.findIndex((m) => m.role === "system");

        if (existingSystemIndex !== -1) {
          messages[existingSystemIndex] = {
            ...messages[existingSystemIndex],
            content: `${platformPrompt}\n\n${messages[existingSystemIndex].content}`,
          };
        } else {
          messages.unshift({ role: "system", content: platformPrompt });
        }
      }

      try {
        return await provider.complete({
          ...request,
          messages,
          model,
          maxTokens,
          temperature,
          provider: normalized.provider,
        });
      } catch (error) {
        const providerError =
          error instanceof Error ? error : new Error("Unknown provider error");
        const hasNextModelCandidate = index < modelCandidates.length - 1;
        logger.warn(
          {
            provider: provider.name,
            model,
            retryable: isRetryableProviderError(providerError),
            modelFallback: hasNextModelCandidate && !normalized.model && isModelAvailabilityError(providerError),
            error: sanitizeProviderError(providerError),
          },
          "provider completion failed, trying fallback",
        );

        if (
          hasNextModelCandidate &&
          !normalized.model &&
          isModelAvailabilityError(providerError)
        ) {
          lastError = providerError;
          continue;
        }

        if (!isRetryableProviderError(providerError)) {
          throw providerError;
        }

        lastError = providerError;
        break;
      }
    }
  }

  throw lastError || new Error("All providers failed");
}

export function completeStream(
  request: CompletionRequest,
): CompletionStream {
  const normalized = normalizeRequestedProviderAndModel({
    provider: request.provider,
    model: request.model,
  });
  const providersInOrder = resolveProviderOrder(
    normalized.provider,
    normalized.model,
    request.allowFallback ?? false,
    request.allowedProviders,
    request.allowedModels,
  ).slice(0, getMaxFallbackAttempts());

  if (providersInOrder.length === 0) {
    throw new Error("No AI providers configured");
  }

  const maxTokens = request.maxTokens ?? 2048;
  const temperature = request.temperature ?? 0.7;

  // Find first provider that supports streaming
  for (const provider of providersInOrder) {
    if (!provider.stream) {
      logger.debug(
        { provider: provider.name },
        "provider does not support streaming, trying next",
      );
      continue;
    }

    const model =
      (normalized.model && provider.models.includes(normalized.model)
        ? normalized.model
        : undefined) ??
      request.allowedModels?.find((allowedModel) =>
        provider.models.includes(allowedModel),
      ) ??
      provider.defaultModel;

    const messages = [...request.messages];
    if (process.env.PLATFORM_SYSTEM_PROMPTS_ENABLED === "true") {
      const platformPrompt = getSystemPromptForModel(model);
      const existingSystemIndex = messages.findIndex((m) => m.role === "system");

      if (existingSystemIndex !== -1) {
        messages[existingSystemIndex] = {
          ...messages[existingSystemIndex],
          content: `${platformPrompt}\n\n${messages[existingSystemIndex].content}`,
        };
      } else {
        messages.unshift({ role: "system", content: platformPrompt });
      }
    }

    logger.info(
      { provider: provider.name, model },
      "starting stream",
    );

    return provider.stream({
      ...request,
      messages,
      model,
      maxTokens,
      temperature,
      provider: normalized.provider,
    });
  }

  throw new CompletionRoutingError(
    "No streaming-capable providers available",
    503,
    ErrorCodes.routingProviderDisabled,
  );
}

export async function embed(
  request: EmbeddingRequest,
): Promise<EmbeddingResponse> {
  const normalized = normalizeRequestedProviderAndModel({
    provider: request.provider,
    model: request.model,
  });

  const enabledProviders = fallbackChain
    .map((providerName) => providerRegistry[providerName])
    .filter((provider) => provider.enabled && provider.embed);

  let providersInOrder = enabledProviders;

  if (normalized.provider) {
    const requested = providerRegistry[normalized.provider as ProviderName];
    if (!requested) {
      throw new CompletionRoutingError(
        `Unsupported provider: ${normalized.provider}`,
        400,
        ErrorCodes.routingUnsupportedProvider,
      );
    }

    if (!requested.enabled || !requested.embed) {
      throw new CompletionRoutingError(
        `Requested provider does not support embeddings: ${normalized.provider}`,
        503,
        ErrorCodes.routingProviderDisabled,
      );
    }

    providersInOrder = [requested];
  }

  if (providersInOrder.length === 0) {
    throw new Error("No embedding providers configured");
  }

  let lastError: Error | null = null;

  for (const provider of providersInOrder) {
    const embeddingModels = provider.embeddingModels ?? [];
    const model =
      normalized.model && embeddingModels.includes(normalized.model)
        ? normalized.model
        : provider.defaultEmbeddingModel;

    if (!model || !provider.embed) {
      continue;
    }

    if (normalized.model && !embeddingModels.includes(normalized.model)) {
      throw new CompletionRoutingError(
        `Model ${normalized.model} is not available for embeddings on provider ${provider.name}`,
        400,
        ErrorCodes.routingUnsupportedModel,
      );
    }

    try {
      return await provider.embed({
        ...request,
        provider: normalized.provider,
        model,
      });
    } catch (error) {
      const providerError =
        error instanceof Error ? error : new Error("Unknown provider error");
      logger.warn(
        {
          provider: provider.name,
          model,
          error: sanitizeProviderError(providerError),
        },
        "provider embedding failed",
      );
      lastError = providerError;
    }
  }

  throw lastError || new Error("All embedding providers failed");
}
