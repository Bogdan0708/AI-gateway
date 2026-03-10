import { ProviderName } from "../types";
import { ErrorCodes, type ErrorCode } from "./error-codes";

interface TenantPolicyConfig {
  allowedProviders?: ProviderName[];
  allowedModels?: string[];
  maxTokens?: number;
  maxConcurrentRequests?: number;
}

interface ParsedTenantPolicyConfig {
  requireTenantId: boolean;
  policies: Record<string, TenantPolicyConfig>;
}

export class TenantPolicyError extends Error {
  public readonly code: ErrorCode;

  constructor(
    message: string,
    public readonly statusCode: number = 403,
    code: ErrorCode = ErrorCodes.tenantUnknown,
  ) {
    super(message);
    this.name = "TenantPolicyError";
    this.code = code;
  }
}

function parseRequireTenantId(value: string | undefined): boolean {
  return value === "true";
}

function parsePolicies(value: string | undefined): Record<string, TenantPolicyConfig> {
  if (!value) {
    return {};
  }

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TENANT_POLICIES_JSON must be a JSON object keyed by tenant id");
  }

  const policies: Record<string, TenantPolicyConfig> = {};

  for (const [tenantId, rawPolicy] of Object.entries(parsed)) {
    if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
      throw new Error(`Invalid tenant policy for ${tenantId}`);
    }

    const policy = rawPolicy as {
      allowedProviders?: unknown;
      allowedModels?: unknown;
      maxTokens?: unknown;
      maxConcurrentRequests?: unknown;
    };

    policies[tenantId] = {
      allowedProviders: Array.isArray(policy.allowedProviders)
        ? (policy.allowedProviders.filter(
            (provider): provider is ProviderName => typeof provider === "string",
          ) as ProviderName[])
        : undefined,
      allowedModels: Array.isArray(policy.allowedModels)
        ? policy.allowedModels.filter(
            (model): model is string => typeof model === "string" && model.length > 0,
          )
        : undefined,
      maxTokens:
        typeof policy.maxTokens === "number" && Number.isInteger(policy.maxTokens)
          ? policy.maxTokens
          : undefined,
      maxConcurrentRequests:
        typeof policy.maxConcurrentRequests === "number" &&
        Number.isInteger(policy.maxConcurrentRequests)
          ? policy.maxConcurrentRequests
          : undefined,
    };
  }

  return policies;
}

let cachedConfig:
  | {
      requireTenantIdEnv: string | undefined;
      policiesEnv: string | undefined;
      config: ParsedTenantPolicyConfig;
    }
  | undefined;

export function loadTenantPolicyConfig(): ParsedTenantPolicyConfig {
  const requireTenantIdEnv = process.env.REQUIRE_TENANT_ID;
  const policiesEnv = process.env.TENANT_POLICIES_JSON;

  if (
    cachedConfig &&
    cachedConfig.requireTenantIdEnv === requireTenantIdEnv &&
    cachedConfig.policiesEnv === policiesEnv
  ) {
    return cachedConfig.config;
  }

  const config = {
    requireTenantId: parseRequireTenantId(requireTenantIdEnv),
    policies: parsePolicies(policiesEnv),
  };

  cachedConfig = {
    requireTenantIdEnv,
    policiesEnv,
    config,
  };

  return config;
}

export function resetTenantPolicyConfigCache(): void {
  cachedConfig = undefined;
}

export function resolveTenantId(
  headerTenantId: string | undefined,
  bodyTenantId: string | undefined,
): string | undefined {
  const tenantId = headerTenantId ?? bodyTenantId;

  if (headerTenantId && bodyTenantId && headerTenantId !== bodyTenantId) {
    throw new TenantPolicyError(
      "Tenant ID mismatch between x-tenant-id header and tenant_id body field",
      400,
      ErrorCodes.tenantMismatch,
    );
  }

  if (!tenantId) {
    return undefined;
  }

  if (tenantId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(tenantId)) {
    throw new TenantPolicyError(
      "Tenant ID format is invalid",
      400,
      ErrorCodes.tenantMismatch,
    );
  }

  return tenantId;
}

export function enforceTenantPolicy(input: {
  tenantId?: string;
  provider?: string;
  model?: string;
  maxTokens?: number;
}): {
  tenantId?: string;
  allowedProviders?: ProviderName[];
  allowedModels?: string[];
} {
  const config = loadTenantPolicyConfig();

  if (config.requireTenantId && !input.tenantId) {
    throw new TenantPolicyError(
      "Tenant ID is required",
      400,
      ErrorCodes.tenantRequired,
    );
  }

  if (!input.tenantId) {
    return {};
  }

  const policy = config.policies[input.tenantId];
  if (!policy) {
    if (Object.keys(config.policies).length === 0) {
      return { tenantId: input.tenantId };
    }

    throw new TenantPolicyError(
      `Unknown tenant: ${input.tenantId}`,
      403,
      ErrorCodes.tenantUnknown,
    );
  }

  if (
    input.provider &&
    policy.allowedProviders &&
    !policy.allowedProviders.includes(input.provider as ProviderName)
  ) {
    throw new TenantPolicyError(
      `Provider ${input.provider} is not allowed for tenant ${input.tenantId}`,
      403,
      ErrorCodes.tenantProviderDenied,
    );
  }

  if (
    input.model &&
    policy.allowedModels &&
    !policy.allowedModels.includes(input.model)
  ) {
    throw new TenantPolicyError(
      `Model ${input.model} is not allowed for tenant ${input.tenantId}`,
      403,
      ErrorCodes.tenantModelDenied,
    );
  }

  if (
    typeof input.maxTokens === "number" &&
    typeof policy.maxTokens === "number" &&
    input.maxTokens > policy.maxTokens
  ) {
    throw new TenantPolicyError(
      `max_tokens exceeds tenant limit of ${policy.maxTokens}`,
      400,
      ErrorCodes.tenantMaxTokensExceeded,
    );
  }

  return {
    tenantId: input.tenantId,
    allowedProviders: policy.allowedProviders,
    allowedModels: policy.allowedModels,
  };
}

export function filterProvidersForTenant(input: {
  tenantId?: string;
  providers: Array<{
    id: ProviderName;
    enabled: boolean;
    defaultModel: string;
    models: string[];
  }>;
}) {
  const config = loadTenantPolicyConfig();
  if (!input.tenantId) {
    return input.providers;
  }

  const policy = config.policies[input.tenantId];
  if (!policy) {
    if (Object.keys(config.policies).length === 0) {
      return input.providers;
    }

    throw new TenantPolicyError(
      `Unknown tenant: ${input.tenantId}`,
      403,
      ErrorCodes.tenantUnknown,
    );
  }

  return input.providers
    .filter(
      (provider) =>
        !policy.allowedProviders || policy.allowedProviders.includes(provider.id),
    )
    .map((provider) => ({
      ...provider,
      models: policy.allowedModels
        ? provider.models.filter((model) => policy.allowedModels?.includes(model))
        : provider.models,
    }))
    .filter((provider) => provider.models.length > 0);
}
