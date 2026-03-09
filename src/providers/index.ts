import { logger } from "../lib/logger";
import { ErrorCodes, type ErrorCode } from "../lib/error-codes";
import {
  CompletionRequest,
  CompletionResponse,
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

export const providers = fallbackChain.map(
  (providerName) => providerRegistry[providerName],
);

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

function sanitizeProviderError(error: Error): string {
  if (error.name === "AbortError") {
    return "provider request timed out";
  }

  return error.message.replace(/\s+/g, " ").trim().slice(0, 200);
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

  return input;
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

    const fallbackProviders = requestedModel
      ? enabledProviders.filter(
          (provider) =>
            provider.name !== requested.name &&
            provider.models.includes(requestedModel),
        )
      : enabledProviders.filter((provider) => provider.name !== requested.name);

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

  return allowFallback ? matchingProviders : [matchingProviders[0]];
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
  );

  if (providersInOrder.length === 0) {
    throw new Error("No AI providers configured");
  }

  const maxTokens = request.maxTokens ?? 2048;
  const temperature = request.temperature ?? 0.7;

  let lastError: Error | null = null;

  for (const provider of providersInOrder) {
    const model =
      normalized.model ??
      request.allowedModels?.find((allowedModel) =>
        provider.models.includes(allowedModel),
      ) ??
      provider.defaultModel;

    try {
      return await provider.complete({
        ...request,
        model,
        maxTokens,
        temperature,
        provider: normalized.provider,
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
        "provider completion failed, trying fallback",
      );
      lastError = providerError;
    }
  }

  throw lastError || new Error("All providers failed");
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
