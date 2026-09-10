import { z } from "zod";
import { ProviderName } from "../types";
import { ErrorCodes, type ErrorCode } from "./error-codes";

const tenantPolicySchema = z.object({
  allowedProviders: z.array(z.string()).optional(),
  allowedModels: z.array(z.string()).optional(),
  maxTokens: z.number().int().positive().optional(),
  maxConcurrentRequests: z.number().int().positive().optional(),
  maxMonthlyTokens: z.number().int().positive().optional(),
});

const policiesSchema = z.record(z.string(), tenantPolicySchema);

interface TenantPolicyConfig {
  allowedProviders?: ProviderName[];
  allowedModels?: string[];
  maxTokens?: number;
  maxConcurrentRequests?: number;
  maxMonthlyTokens?: number;
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

  try {
    const parsed = JSON.parse(value);
    const validated = policiesSchema.parse(parsed);
    
    // Type cast string providers to ProviderName after validation
    const policies: Record<string, TenantPolicyConfig> = {};
    for (const [tenantId, policy] of Object.entries(validated)) {
      policies[tenantId] = {
        ...policy,
        allowedProviders: policy.allowedProviders as ProviderName[] | undefined,
      };
    }
    return policies;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid TENANT_POLICIES_JSON: ${error.issues[0].message} at ${error.issues[0].path.join(".")}`,
        { cause: error },
      );
    }
    throw new Error(
      `TENANT_POLICIES_JSON must be a valid JSON object: ${error instanceof Error ? error.message : "unknown error"}`,
      { cause: error },
    );
  }
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
  maxMonthlyTokens?: number;
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
    maxMonthlyTokens: policy.maxMonthlyTokens,
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
