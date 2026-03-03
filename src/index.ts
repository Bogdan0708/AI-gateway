/**
 * AI Gateway v3.0.0
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
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { v4 as uuidv4 } from "uuid";
import { httpLogger, logger } from "./lib/logger";
import { authMiddleware } from "./middleware/auth";
import {
  validateChatCompletion,
  validateSimpleCompletion,
} from "./middleware/validate";
import { complete, listProviders } from "./providers";
import { CompletionMessage } from "./types";

const app = express();
const port = Number(process.env.PORT || 8080);

const defaultOrigins = [
  "https://primaria.ro",
  "https://*.primaria.ro",
  "https://primaria-j3dqdqxnyq-lm.a.run.app",
  "https://api.mitchfromtransylvania.com",
  "https://mitchfromtransylvania.com",
  "https://eufunding.ro",
  "https://*.eufunding.ro",
  "https://fondeu-platform-857599941951.europe-west2.run.app",
  "http://localhost:3000",
  "http://localhost:3006",
];

const corsOrigins =
  process.env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) || defaultOrigins;

app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(httpLogger);
app.use(authMiddleware);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  }),
);

app.get("/health", (_req: Request, res: Response) => {
  const enabledProviders = listProviders()
    .filter((provider) => provider.enabled)
    .map((provider) => provider.id);

  res.json({
    status: "healthy",
    service: "ai-gateway",
    version: "3.0.0",
    providers: enabledProviders,
    timestamp: new Date().toISOString(),
  });
});

app.get("/ping", (_req: Request, res: Response) => {
  res.send("pong");
});

app.get("/providers", (req: Request, res: Response) => {
  req.log.info("listing providers");
  res.json({ providers: listProviders() });
});

app.post(
  "/v1/chat/completions",
  validateChatCompletion,
  async (req: Request, res: Response) => {
    try {
      const {
        messages,
        provider,
        model,
        max_tokens,
        maxTokens,
        temperature,
        tenant_id,
        task_type,
      } = req.body as {
        messages: CompletionMessage[];
        provider?: string;
        model?: string;
        max_tokens?: number;
        maxTokens?: number;
        temperature?: number;
        tenant_id?: string;
        task_type?: string;
      };

      const result = await complete({
        messages,
        provider,
        model,
        maxTokens: max_tokens ?? maxTokens,
        temperature,
        tenantId: tenant_id,
        taskType: task_type,
      });

      req.log.info(
        {
          provider: result.provider,
          model: result.model,
          totalTokens: result.usage.totalTokens,
          latencyMs: result.latencyMs,
        },
        "chat completion succeeded",
      );

      res.json({
        id: `chatcmpl-${uuidv4()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: result.model,
        provider: result.provider,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: result.content,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.totalTokens,
        },
        latency_ms: result.latencyMs,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "AI completion failed";
      req.log.error({ error: message }, "chat completion failed");

      res.status(500).json({
        error: {
          message,
          type: "ai_error",
        },
      });
    }
  },
);

app.post(
  "/complete",
  validateSimpleCompletion,
  async (req: Request, res: Response) => {
    try {
      const {
        prompt,
        system,
        provider,
        model,
        max_tokens,
        maxTokens,
        temperature,
      } = req.body as {
        prompt: string;
        system?: string;
        provider?: string;
        model?: string;
        max_tokens?: number;
        maxTokens?: number;
        temperature?: number;
      };

      const messages: CompletionMessage[] = [];
      if (system) {
        messages.push({ role: "system", content: system });
      }
      messages.push({ role: "user", content: prompt });

      const result = await complete({
        messages,
        provider,
        model,
        maxTokens: max_tokens ?? maxTokens,
        temperature,
      });

      req.log.info(
        {
          provider: result.provider,
          model: result.model,
          totalTokens: result.usage.totalTokens,
          latencyMs: result.latencyMs,
        },
        "simple completion succeeded",
      );

      res.json({
        content: result.content,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        latency_ms: result.latencyMs,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "AI completion failed";
      req.log.error({ error: message }, "simple completion failed");

      res.status(500).json({
        error: {
          message,
          type: "ai_error",
        },
      });
    }
  },
);

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  req.log.error({ err }, "unhandled server error");

  res.status(500).json({
    error: {
      message:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
      type: "server_error",
    },
  });
});

app.listen(port, () => {
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

export default app;
