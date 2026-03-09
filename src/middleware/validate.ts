import { NextFunction, Request, Response } from "express";
import { z } from "zod";

const MAX_MESSAGES = 50;
const MAX_CONTENT_LENGTH = 32000;
const MAX_TOKENS_LIMIT = 16384;
const MIN_TOKENS_LIMIT = 1;

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z
    .string()
    .max(
      MAX_CONTENT_LENGTH,
      `message content must be at most ${MAX_CONTENT_LENGTH} characters`,
    ),
});

const tokensErrorMsg = `max_tokens must be an integer between ${MIN_TOKENS_LIMIT} and ${MAX_TOKENS_LIMIT}`;
const temperatureErrorMsg = "temperature must be a number between 0 and 2";

const chatCompletionSchema = z
  .object({
    messages: z
      .array(messageSchema)
      .min(1, "messages cannot be empty")
      .max(MAX_MESSAGES, `messages must contain at most ${MAX_MESSAGES} items`),
    temperature: z
      .number()
      .min(0, temperatureErrorMsg)
      .max(2, temperatureErrorMsg)
      .optional(),
    max_tokens: z
      .number()
      .int(tokensErrorMsg)
      .min(MIN_TOKENS_LIMIT, tokensErrorMsg)
      .max(MAX_TOKENS_LIMIT, tokensErrorMsg)
      .optional(),
    maxTokens: z
      .number()
      .int(tokensErrorMsg)
      .min(MIN_TOKENS_LIMIT, tokensErrorMsg)
      .max(MAX_TOKENS_LIMIT, tokensErrorMsg)
      .optional(),
    tenant_id: z.string().min(1, "tenant_id cannot be empty").optional(),
    allow_fallback: z.boolean().optional(),
    allowFallback: z.boolean().optional(),
  })
  .passthrough();

const simpleCompletionSchema = z
  .object({
    prompt: z
      .string()
      .min(1, "prompt is required")
      .max(
        MAX_CONTENT_LENGTH,
        `prompt must be at most ${MAX_CONTENT_LENGTH} characters`,
      ),
    system: z
      .string()
      .max(
        MAX_CONTENT_LENGTH,
        `system must be at most ${MAX_CONTENT_LENGTH} characters`,
      )
      .optional(),
    temperature: z
      .number()
      .min(0, temperatureErrorMsg)
      .max(2, temperatureErrorMsg)
      .optional(),
    max_tokens: z
      .number()
      .int(tokensErrorMsg)
      .min(MIN_TOKENS_LIMIT, tokensErrorMsg)
      .max(MAX_TOKENS_LIMIT, tokensErrorMsg)
      .optional(),
    maxTokens: z
      .number()
      .int(tokensErrorMsg)
      .min(MIN_TOKENS_LIMIT, tokensErrorMsg)
      .max(MAX_TOKENS_LIMIT, tokensErrorMsg)
      .optional(),
    tenant_id: z.string().min(1, "tenant_id cannot be empty").optional(),
    allow_fallback: z.boolean().optional(),
    allowFallback: z.boolean().optional(),
  })
  .passthrough();

const embeddingSchema = z
  .object({
    input: z.union([
      z
        .string()
        .min(1, "input is required")
        .max(
          MAX_CONTENT_LENGTH,
          `input must be at most ${MAX_CONTENT_LENGTH} characters`,
        ),
      z
        .array(
          z
            .string()
            .min(1, "input items cannot be empty")
            .max(
              MAX_CONTENT_LENGTH,
              `input items must be at most ${MAX_CONTENT_LENGTH} characters`,
            ),
        )
        .min(1, "input array cannot be empty")
        .max(MAX_MESSAGES, `input array must contain at most ${MAX_MESSAGES} items`),
    ]),
    tenant_id: z.string().min(1, "tenant_id cannot be empty").optional(),
  })
  .passthrough();

export function validateChatCompletion(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "request body must be an object" });
    return;
  }

  const result = chatCompletionSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  next();
}

export function validateSimpleCompletion(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "request body must be an object" });
    return;
  }

  const result = simpleCompletionSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  next();
}

export function validateEmbeddingRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "request body must be an object" });
    return;
  }

  const result = embeddingSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.issues[0].message });
    return;
  }

  next();
}
