/**
 * AI Gateway
 *
 * Environment variables:
 * - PORT: server port (default 8080)
 * - NODE_ENV: runtime environment
 * - LOG_LEVEL: pino log level (default info)
 * - CORS_ORIGINS: comma-separated allowed origins
 * - GATEWAY_MASTER_KEY: bearer token required for authenticated routes
 * - OPENAI_API_KEY: enables OpenAI provider
 * - ANTHROPIC_API_KEY: enables Claude provider
 * - GOOGLE_API_KEY: enables Gemini provider
 * - XAI_API_KEY: enables xAI Grok provider
 * - GROQ_API_KEY: enables Groq provider
 * - PERPLEXITY_API_KEY: enables Perplexity provider
 */

import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import {
  ConcurrencyLimitError,
  getInflightCounts,
  withConcurrencyLimit,
} from "./lib/concurrency";
import { ErrorCodes } from "./lib/error-codes";
import { httpLogger, logger } from "./lib/logger";
import { getRequestErrorResponse } from "./lib/request-errors";
import { createTelemetryLifecycle } from "./lib/telemetry";
import {
  enforceTenantPolicy,
  filterProvidersForTenant,
  resolveTenantId,
  TenantPolicyError,
} from "./lib/tenant-policy";
import { authMiddleware, isAuthorizedRequest } from "./middleware/auth";
import {
  validateChatCompletion,
  validateEmbeddingRequest,
  validateSimpleCompletion,
} from "./middleware/validate";
import {
  checkProviderReadiness,
  complete,
  completeStream,
  CompletionRoutingError,
  embed,
  listProviders,
} from "./providers";
import {
  aiRequestDurationMs,
  aiRequestsTotal,
  aiTokensTotal,
  httpRequestDurationMs,
  httpRequestsTotal,
  metricsRegistry,
} from "./lib/metrics";
import { sanitizeProviderError } from "./lib/provider-errors";
import { APP_VERSION } from "./lib/version";
import { CompletionMessage } from "./types";

const app = express();
const port = Number(process.env.PORT || 8080);
const telemetry = createTelemetryLifecycle(logger);

// Cloud Run sits behind Google-managed proxies/load balancers.
// Trust the first proxy hop so req.ip and rate limiting use the client IP.
app.set("trust proxy", 1);

const defaultOrigins: (string | RegExp)[] = [
  "https://primaria.ro",
  /^https:\/\/[a-z0-9-]+\.primaria\.ro$/,
  "https://primaria-j3dqdqxnyq-lm.a.run.app",
  "https://api.mitchfromtransylvania.com",
  "https://mitchfromtransylvania.com",
  "https://eufunding.ro",
  /^https:\/\/[a-z0-9-]+\.eufunding\.ro$/,
  "https://fondeu-platform-857599941951.europe-west2.run.app",
  "http://localhost:3000",
  "http://localhost:3006",
];

const corsOrigins =
  process.env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) || defaultOrigins;

function getHeaderTenantId(req: Request): string | undefined {
  const headerValue = req.headers["x-tenant-id"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }

  if (Array.isArray(headerValue) && headerValue.length > 0 && headerValue[0]) {
    return headerValue[0].trim();
  }

  return undefined;
}

function getBodyTenantId(req: Request): string | undefined {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return undefined;
  }

  const tenantId = (req.body as { tenant_id?: unknown }).tenant_id;
  return typeof tenantId === "string" && tenantId.trim() ? tenantId.trim() : undefined;
}

export function getRateLimitKey(req: Request): string {
  try {
    const tenantId = resolveTenantId(getHeaderTenantId(req), getBodyTenantId(req));
    if (tenantId) {
      return `tenant:${tenantId}`;
    }
  } catch {
    // Fall back to IP-based limiting when tenant identity is malformed.
  }

  return `ip:${ipKeyGenerator(req.ip || "unknown")}`;
}

function isFallbackResponse(input: {
  requestedProvider?: string;
  requestedModel?: string;
  provider: string;
  model: string;
}): boolean {
  return Boolean(
    (input.requestedProvider && input.requestedProvider !== input.provider) ||
      (input.requestedModel && input.requestedModel !== input.model),
  );
}

export async function buildReadyResponse(
  req: Pick<Request, "headers">,
  deps: {
    checkProviderReadiness: typeof checkProviderReadiness;
    listProviders: typeof listProviders;
    getInflightCounts: typeof getInflightCounts;
    isAuthorizedRequest: typeof isAuthorizedRequest;
  } = {
    checkProviderReadiness,
    listProviders,
    getInflightCounts,
    isAuthorizedRequest,
  },
): Promise<{
  statusCode: number;
  body: Record<string, unknown>;
}> {
  const masterKeyConfigured = Boolean(process.env.GATEWAY_MASTER_KEY);
  const detailed = deps.isAuthorizedRequest(req as Request);
  const configuredProviders = deps
    .listProviders()
    .filter((provider) => provider.enabled);

  try {
    if (!detailed) {
      const ready = masterKeyConfigured && configuredProviders.length > 0;

      return {
        statusCode: ready ? 200 : 503,
        body: {
          status: ready ? "ready" : "not_ready",
          service: "ai-gateway",
          version: APP_VERSION,
          timestamp: new Date().toISOString(),
        },
      };
    }

    const providers = await deps.checkProviderReadiness();
    const ready =
      masterKeyConfigured &&
      configuredProviders.length > 0 &&
      providers.some((provider) => provider.enabled && provider.ready);

    return {
      statusCode: ready ? 200 : 503,
      body: {
        status: ready ? "ready" : "not_ready",
        service: "ai-gateway",
        version: APP_VERSION,
        master_key_configured: masterKeyConfigured,
        inflight: { global: deps.getInflightCounts().global },
        providers,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      statusCode: 503,
      body: {
        status: "not_ready",
        service: "ai-gateway",
        version: APP_VERSION,
        ...(detailed ? { error: sanitizeProviderError(error) } : {}),
        timestamp: new Date().toISOString(),
      },
    };
  }
}

export function buildHealthResponse(
  enabledProviders: string[],
): {
  status: "healthy";
  service: "ai-gateway";
  version: string;
  providers: string[];
  timestamp: string;
} {
  return {
    status: "healthy",
    service: "ai-gateway",
    version: APP_VERSION,
    providers: enabledProviders,
    timestamp: new Date().toISOString(),
  };
}

export function buildEmbeddingResponse(input: {
  embeddings: number[][];
  provider: string;
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  tenantId?: string;
}) {
  return {
    object: "list" as const,
    data: input.embeddings.map((embedding, index) => ({
      object: "embedding" as const,
      index,
      embedding,
    })),
    model: input.model,
    provider: input.provider,
    usage: {
      prompt_tokens: input.usage.promptTokens,
      total_tokens: input.usage.totalTokens,
    },
    latency_ms: input.latencyMs,
    tenant_id: input.tenantId,
  };
}

export function buildChatCompletionResponse(input: {
  content: string;
  provider: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  tenantId?: string;
}) {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion" as const,
    created: Math.floor(Date.now() / 1000),
    model: input.model,
    provider: input.provider,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant" as const,
          content: input.content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: input.usage.promptTokens,
      completion_tokens: input.usage.completionTokens,
      total_tokens: input.usage.totalTokens,
    },
    latency_ms: input.latencyMs,
    tenant_id: input.tenantId,
  };
}

export function buildSimpleCompletionResponse(input: {
  content: string;
  provider: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  tenantId?: string;
}) {
  return {
    content: input.content,
    provider: input.provider,
    model: input.model,
    usage: input.usage,
    latency_ms: input.latencyMs,
    tenant_id: input.tenantId,
  };
}

function handleOperationError(
  req: Request,
  res: Response,
  error: unknown,
  options: {
    operation: string;
    failureCode: string;
    failureMessage: string;
  },
): void {
  if (error instanceof CompletionRoutingError) {
    req.log.warn(
      { code: error.code, error: error.message },
      `${options.operation} routing rejected`,
    );
    res.status(error.statusCode).json({
      error: {
        message: error.message,
        type: "routing_error",
        code: error.code,
      },
    });
    return;
  }

  if (error instanceof TenantPolicyError) {
    req.log.warn(
      { code: error.code, error: error.message },
      `${options.operation} blocked by tenant policy`,
    );
    res.status(error.statusCode).json({
      error: {
        message: error.message,
        type: "tenant_policy_error",
        code: error.code,
      },
    });
    return;
  }

  if (error instanceof ConcurrencyLimitError) {
    req.log.warn(
      { code: error.code, error: error.message, inflight: getInflightCounts() },
      `${options.operation} rejected by concurrency limit`,
    );
    res.status(error.statusCode).json({
      error: {
        message: error.message,
        type: "concurrency_limit_error",
        code: error.code,
      },
    });
    return;
  }

  req.log.error(
    {
      code: options.failureCode,
      error: sanitizeProviderError(error),
    },
    `${options.operation} failed`,
  );

  res.status(500).json({
    error: {
      message: options.failureMessage,
      type: "ai_error",
      code: options.failureCode,
    },
  });
}

function recordAiSuccess(
  operation: string,
  result: {
    provider: string;
    model: string;
    usage: { promptTokens: number; completionTokens?: number; totalTokens: number };
    latencyMs: number;
  },
): void {
  const labels = { operation, provider: result.provider, model: result.model };
  aiRequestsTotal.inc({ ...labels, status: "success" });
  aiRequestDurationMs.observe(labels, result.latencyMs);
  aiTokensTotal.inc(
    { provider: result.provider, model: result.model, token_type: "prompt" },
    result.usage.promptTokens,
  );
  if (result.usage.completionTokens) {
    aiTokensTotal.inc(
      { provider: result.provider, model: result.model, token_type: "completion" },
      result.usage.completionTokens,
    );
  }
}

function recordAiError(
  operation: string,
  provider?: string,
  model?: string,
): void {
  aiRequestsTotal.inc({
    operation,
    provider: provider || "unknown",
    model: model || "unknown",
    status: "error",
  });
}

app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(telemetry.middleware);
app.use(httpLogger);
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const route = (req.route as { path?: string } | undefined)?.path || req.path;
    httpRequestsTotal.inc({
      method: req.method,
      path: route,
      status_code: res.statusCode,
    });
    httpRequestDurationMs.observe(
      { method: req.method, path: route, status_code: res.statusCode },
      duration,
    );
  });
  next();
});
app.use(authMiddleware);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
    keyGenerator: getRateLimitKey,
    skip: (req) =>
      req.path === "/health" ||
      req.path === "/ping" ||
      req.path === "/ready" ||
      req.path === "/metrics",
  }),
);

// Stricter rate limit for /ready — it triggers outbound probe requests
app.use(
  "/ready",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 12,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many readiness checks, please try again later." },
  }),
);

app.get("/health", (_req: Request, res: Response) => {
  const enabledProviders = listProviders()
    .filter((provider) => provider.enabled)
    .map((provider) => provider.id);

  res.json(buildHealthResponse(enabledProviders));
});

app.get("/ping", (_req: Request, res: Response) => {
  res.send("pong");
});

app.get("/ready", async (req: Request, res: Response) => {
  const response = await buildReadyResponse(req);
  res.status(response.statusCode).json(response.body);
});

app.get("/metrics", async (_req: Request, res: Response) => {
  res.set("Content-Type", metricsRegistry.contentType);
  res.end(await metricsRegistry.metrics());
});

app.get("/providers", (req: Request, res: Response) => {
  req.log.info("listing providers");
  try {
    const tenantId = resolveTenantId(getHeaderTenantId(req), undefined);
    enforceTenantPolicy({ tenantId });
    const providers = filterProvidersForTenant({
      tenantId,
      providers: listProviders(),
    });
    res.json({ providers, tenant_id: tenantId });
  } catch (error) {
    if (error instanceof TenantPolicyError) {
      res.status(error.statusCode).json({
        error: {
          message: error.message,
          type: "tenant_policy_error",
          code: error.code,
        },
      });
      return;
    }

    throw error;
  }
});

app.post(
  "/v1/embeddings",
  validateEmbeddingRequest,
  async (req: Request, res: Response) => {
    const { input, model, provider, tenant_id } = req.body as {
      input: string | string[];
      model?: string;
      provider?: string;
      tenant_id?: string;
    };

    try {
      const resolvedTenantId = resolveTenantId(getHeaderTenantId(req), tenant_id);

      const result = await withConcurrencyLimit(resolvedTenantId, () =>
        embed({
          ...enforceTenantPolicy({
            tenantId: resolvedTenantId,
            provider,
            model,
          }),
          input,
          provider,
          model,
          tenantId: resolvedTenantId,
        }),
      );

      req.log.info(
        {
          tenantId: resolvedTenantId,
          requestedProvider: provider,
          requestedModel: model,
          provider: result.provider,
          model: result.model,
          isFallback: isFallbackResponse({
            requestedProvider: provider,
            requestedModel: model,
            provider: result.provider,
            model: result.model,
          }),
          totalTokens: result.usage.totalTokens,
          latencyMs: result.latencyMs,
        },
        "embedding request succeeded",
      );

      recordAiSuccess("embedding", result);

      res.json(
        buildEmbeddingResponse({
          ...result,
          tenantId: resolvedTenantId,
        }),
      );
    } catch (error) {
      recordAiError("embedding", provider, model);
      handleOperationError(req, res, error, {
        operation: "embedding request",
        failureCode: ErrorCodes.aiEmbeddingFailed,
        failureMessage: "AI embedding failed",
      });
    }
  },
);

app.post(
  "/v1/chat/completions",
  validateChatCompletion,
  async (req: Request, res: Response) => {
    const {
      messages,
      provider,
      model,
      max_tokens,
      maxTokens,
      temperature,
      tenant_id,
      task_type,
      stream: isStream,
      allow_fallback,
      allowFallback,
    } = req.body as {
      messages: CompletionMessage[];
      provider?: string;
      model?: string;
      max_tokens?: number;
      maxTokens?: number;
      temperature?: number;
      tenant_id?: string;
      task_type?: string;
      stream?: boolean;
      allow_fallback?: boolean;
      allowFallback?: boolean;
    };

    try {
      const resolvedTenantId = resolveTenantId(getHeaderTenantId(req), tenant_id);

      if (isStream) {
        req.setTimeout(120_000);

        enforceTenantPolicy({
          tenantId: resolvedTenantId,
          provider,
          model,
          maxTokens: max_tokens ?? maxTokens,
        });

        const stream = completeStream({
          messages,
          provider,
          model,
          maxTokens: max_tokens ?? maxTokens,
          temperature,
          tenantId: resolvedTenantId,
          taskType: task_type,
          allowFallback: allow_fallback ?? allowFallback,
        });

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Tenant-ID": resolvedTenantId || "",
        });

        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const sseData = {
              id: `chatcmpl-${randomUUID()}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: value.model,
              provider: value.provider,
              choices: [
                {
                  index: 0,
                  delta: { content: value.content },
                  finish_reason: value.finishReason || null,
                },
              ],
              ...(value.usage
                ? {
                    usage: {
                      prompt_tokens: value.usage.promptTokens,
                      completion_tokens: value.usage.completionTokens,
                      total_tokens: value.usage.totalTokens,
                    },
                  }
                : {}),
            };
            res.write(`data: ${JSON.stringify(sseData)}\n\n`);
          }

          res.write("data: [DONE]\n\n");
          res.end();
        } catch (streamError) {
          req.log.error(
            { error: sanitizeProviderError(streamError) },
            "stream failed",
          );
          res.write(
            `data: ${JSON.stringify({ error: { message: "Stream failed", code: ErrorCodes.aiCompletionFailed } })}\n\n`,
          );
          res.end();
        }
        return;
      }

      const result = await withConcurrencyLimit(resolvedTenantId, () =>
        complete({
          ...enforceTenantPolicy({
            tenantId: resolvedTenantId,
            provider,
            model,
            maxTokens: max_tokens ?? maxTokens,
          }),
          messages,
          provider,
          model,
          maxTokens: max_tokens ?? maxTokens,
          temperature,
          tenantId: resolvedTenantId,
          taskType: task_type,
          allowFallback: allow_fallback ?? allowFallback,
        }),
      );

      req.log.info(
        {
          tenantId: resolvedTenantId,
          taskType: task_type,
          requestedProvider: provider,
          requestedModel: model,
          provider: result.provider,
          model: result.model,
          isFallback: isFallbackResponse({
            requestedProvider: provider,
            requestedModel: model,
            provider: result.provider,
            model: result.model,
          }),
          totalTokens: result.usage.totalTokens,
          latencyMs: result.latencyMs,
        },
        "chat completion succeeded",
      );

      recordAiSuccess("chat_completion", result);

      res.json(
        buildChatCompletionResponse({
          ...result,
          tenantId: resolvedTenantId,
        }),
      );
    } catch (error) {
      recordAiError("chat_completion", provider, model);
      handleOperationError(req, res, error, {
        operation: "chat completion",
        failureCode: ErrorCodes.aiCompletionFailed,
        failureMessage: "AI completion failed",
      });
    }
  },
);

app.post(
  "/complete",
  validateSimpleCompletion,
  async (req: Request, res: Response) => {
    const {
      prompt,
      system,
      provider,
      model,
      max_tokens,
      maxTokens,
      temperature,
      tenant_id,
      allow_fallback,
      allowFallback,
    } = req.body as {
      prompt: string;
      system?: string;
      provider?: string;
      model?: string;
      max_tokens?: number;
      maxTokens?: number;
      temperature?: number;
      tenant_id?: string;
      allow_fallback?: boolean;
      allowFallback?: boolean;
    };

    try {
      const resolvedTenantId = resolveTenantId(getHeaderTenantId(req), tenant_id);

      const messages: CompletionMessage[] = [];
      if (system) {
        messages.push({ role: "system", content: system });
      }
      messages.push({ role: "user", content: prompt });

      const result = await withConcurrencyLimit(resolvedTenantId, () =>
        complete({
          ...enforceTenantPolicy({
            tenantId: resolvedTenantId,
            provider,
            model,
            maxTokens: max_tokens ?? maxTokens,
          }),
          messages,
          provider,
          model,
          maxTokens: max_tokens ?? maxTokens,
          temperature,
          tenantId: resolvedTenantId,
          allowFallback: allow_fallback ?? allowFallback,
        }),
      );

      req.log.info(
        {
          tenantId: resolvedTenantId,
          requestedProvider: provider,
          requestedModel: model,
          provider: result.provider,
          model: result.model,
          isFallback: isFallbackResponse({
            requestedProvider: provider,
            requestedModel: model,
            provider: result.provider,
            model: result.model,
          }),
          totalTokens: result.usage.totalTokens,
          latencyMs: result.latencyMs,
        },
        "simple completion succeeded",
      );

      recordAiSuccess("simple_completion", result);

      res.json(
        buildSimpleCompletionResponse({
          ...result,
          tenantId: resolvedTenantId,
        }),
      );
    } catch (error) {
      recordAiError("simple_completion", provider, model);
      handleOperationError(req, res, error, {
        operation: "simple completion",
        failureCode: ErrorCodes.aiCompletionFailed,
        failureMessage: "AI completion failed",
      });
    }
  },
);

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const requestError = getRequestErrorResponse(err);
  if (requestError) {
    req.log.warn(
      { code: requestError.code, error: requestError.message },
      "request parsing failed",
    );
    res.status(requestError.statusCode).json({
      error: {
        message: requestError.message,
        type: "request_error",
        code: requestError.code,
      },
    });
    return;
  }

  req.log.error({ err }, "unhandled server error");

  res.status(500).json({
    error: {
      message:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
      type: "server_error",
      code: ErrorCodes.serverInternal,
    },
  });
});

// Only bind to a port when run directly (not imported by tests).
// supertest creates its own ephemeral server from `app`.
if (require.main === module) {
  void (async () => {
    await telemetry.start();

    const server = app.listen(port, () => {
      const enabledProviders = listProviders()
        .filter((provider) => provider.enabled)
        .map((provider) => provider.id);
      logger.info(
        {
          port,
          enabledProviders,
        },
        "AI Gateway started",
      );
    });

    // Cloud Run sends SIGTERM, then SIGKILL after ~10s.
    // Grace period: stop accepting new connections, drain in-flight requests.
    const SHUTDOWN_TIMEOUT_MS = 8_000;

    function shutdown(signal: string) {
      logger.info({ signal }, "shutdown signal received, draining connections");
      server.close(() => {
        logger.info("all connections drained, flushing telemetry");
        void telemetry.shutdown().finally(() => process.exit(0));
      });
      setTimeout(() => {
        logger.error("shutdown timed out, forcing exit");
        void telemetry.shutdown().finally(() => process.exit(1));
      }, SHUTDOWN_TIMEOUT_MS).unref();
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    process.on("unhandledRejection", (reason) => {
      logger.error({ err: reason }, "unhandled promise rejection");
      shutdown("unhandledRejection");
    });

    process.on("uncaughtException", (err) => {
      logger.error({ err }, "uncaught exception");
      shutdown("uncaughtException");
    });
  })();
}

export { app };
