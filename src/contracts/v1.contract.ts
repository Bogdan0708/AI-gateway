import { z } from "zod";

const providerNameSchema = z.enum([
  "openai",
  "claude",
  "gemini",
  "xai",
  "groq",
  "perplexity",
]);

const isoTimestampSchema = z.string().datetime({ offset: true });

export const healthResponseSchema = z.object({
  status: z.literal("healthy"),
  service: z.literal("ai-gateway"),
  version: z.string().min(1),
  providers: z.array(providerNameSchema),
  timestamp: isoTimestampSchema,
  commit: z.string().min(1).optional(),
});

export const readinessProviderSchema = z.object({
  id: providerNameSchema,
  enabled: z.boolean(),
  ready: z.boolean(),
  reason: z.string(),
});

export const publicReadinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  service: z.literal("ai-gateway"),
  version: z.string().min(1),
  timestamp: isoTimestampSchema,
});

export const authenticatedReadinessResponseSchema =
  publicReadinessResponseSchema.extend({
    master_key_configured: z.boolean(),
    inflight: z.object({
      global: z.number().int().min(0),
    }),
    providers: z.array(readinessProviderSchema),
  });

export const providersResponseSchema = z.object({
  providers: z.array(
    z.object({
      id: providerNameSchema,
      enabled: z.boolean(),
      defaultModel: z.string().min(1),
      models: z.array(z.string().min(1)),
    }),
  ),
  tenant_id: z.string().min(1).optional(),
});

export const embeddingsResponseSchema = z.object({
  object: z.literal("list"),
  data: z.array(
    z.object({
      object: z.literal("embedding"),
      index: z.number().int().min(0),
      embedding: z.array(z.number()),
    }),
  ),
  model: z.string().min(1),
  provider: providerNameSchema,
  usage: z.object({
    prompt_tokens: z.number().int().min(0),
    total_tokens: z.number().int().min(0),
  }),
  latency_ms: z.number().min(0),
  tenant_id: z.string().min(1).optional(),
});

export const chatCompletionResponseSchema = z.object({
  id: z.string().regex(/^chatcmpl-/),
  object: z.literal("chat.completion"),
  created: z.number().int().nonnegative(),
  model: z.string().min(1),
  provider: providerNameSchema,
  choices: z.array(
    z.object({
      index: z.number().int().min(0),
      message: z.object({
        role: z.literal("assistant"),
        content: z.string(),
      }),
      finish_reason: z.string().min(1),
    }),
  ),
  usage: z.object({
    prompt_tokens: z.number().int().min(0),
    completion_tokens: z.number().int().min(0),
    total_tokens: z.number().int().min(0),
  }),
  latency_ms: z.number().min(0),
  tenant_id: z.string().min(1).optional(),
});

export const estimateResponseSchema = z.object({
  object: z.literal("estimate"),
  provider: providerNameSchema,
  model: z.string().min(1),
  usage: z.object({
    prompt_tokens: z.number().int().min(0),
    completion_tokens: z.number().int().min(0),
    total_tokens: z.number().int().min(0),
  }),
  cost: z.object({
    usd: z.number().min(0),
    cents: z.number().min(0),
  }),
  pricing: z.object({
    input_per_1k_usd: z.number().min(0),
    output_per_1k_usd: z.number().min(0),
  }),
  tenant_id: z.string().min(1).optional(),
});

export const simpleCompletionResponseSchema = z.object({
  content: z.string(),
  provider: providerNameSchema,
  model: z.string().min(1),
  usage: z.object({
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
  }),
  latency_ms: z.number().min(0),
  tenant_id: z.string().min(1).optional(),
});

export const structuredErrorResponseSchema = z.object({
  error: z.object({
    message: z.string().min(1),
    type: z.string().min(1),
    code: z.string().min(1).optional(),
  }),
});
