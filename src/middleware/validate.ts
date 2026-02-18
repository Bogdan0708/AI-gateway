import { NextFunction, Request, Response } from 'express';
import { CompletionMessage } from '../types';

const MAX_MESSAGES = 50;
const MAX_CONTENT_LENGTH = 32000;
const MAX_TOKENS_LIMIT = 16384;
const MIN_TOKENS_LIMIT = 1;

const ALLOWED_ROLES = new Set<CompletionMessage['role']>(['system', 'user', 'assistant']);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readMaxTokens(body: Record<string, unknown>): unknown {
  if (body.max_tokens !== undefined) {
    return body.max_tokens;
  }

  return body.maxTokens;
}

function validateTemperature(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 2) {
    return 'temperature must be a number between 0 and 2';
  }

  return null;
}

function validateMaxTokens(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < MIN_TOKENS_LIMIT
    || value > MAX_TOKENS_LIMIT
  ) {
    return `max_tokens must be an integer between ${MIN_TOKENS_LIMIT} and ${MAX_TOKENS_LIMIT}`;
  }

  return null;
}

function validateMessageArray(messages: unknown): string | null {
  if (!Array.isArray(messages)) {
    return 'messages must be an array';
  }

  if (messages.length === 0) {
    return 'messages cannot be empty';
  }

  if (messages.length > MAX_MESSAGES) {
    return `messages must contain at most ${MAX_MESSAGES} items`;
  }

  for (const message of messages) {
    if (!isObject(message)) {
      return 'each message must be an object';
    }

    if (!ALLOWED_ROLES.has(message.role as CompletionMessage['role'])) {
      return 'message role must be one of: system, user, assistant';
    }

    if (typeof message.content !== 'string') {
      return 'message content must be a string';
    }

    if (message.content.length > MAX_CONTENT_LENGTH) {
      return `message content must be at most ${MAX_CONTENT_LENGTH} characters`;
    }
  }

  return null;
}

function sendValidationError(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

export function validateChatCompletion(req: Request, res: Response, next: NextFunction): void {
  if (!isObject(req.body)) {
    sendValidationError(res, 'request body must be an object');
    return;
  }

  const messageError = validateMessageArray(req.body.messages);
  if (messageError) {
    sendValidationError(res, messageError);
    return;
  }

  const temperatureError = validateTemperature(req.body.temperature);
  if (temperatureError) {
    sendValidationError(res, temperatureError);
    return;
  }

  const maxTokensError = validateMaxTokens(readMaxTokens(req.body));
  if (maxTokensError) {
    sendValidationError(res, maxTokensError);
    return;
  }

  next();
}

export function validateSimpleCompletion(req: Request, res: Response, next: NextFunction): void {
  if (!isObject(req.body)) {
    sendValidationError(res, 'request body must be an object');
    return;
  }

  if (typeof req.body.prompt !== 'string' || !req.body.prompt.trim()) {
    sendValidationError(res, 'prompt is required');
    return;
  }

  if (req.body.prompt.length > MAX_CONTENT_LENGTH) {
    sendValidationError(res, `prompt must be at most ${MAX_CONTENT_LENGTH} characters`);
    return;
  }

  if (req.body.system !== undefined) {
    if (typeof req.body.system !== 'string') {
      sendValidationError(res, 'system must be a string');
      return;
    }

    if (req.body.system.length > MAX_CONTENT_LENGTH) {
      sendValidationError(res, `system must be at most ${MAX_CONTENT_LENGTH} characters`);
      return;
    }
  }

  const temperatureError = validateTemperature(req.body.temperature);
  if (temperatureError) {
    sendValidationError(res, temperatureError);
    return;
  }

  const maxTokensError = validateMaxTokens(readMaxTokens(req.body));
  if (maxTokensError) {
    sendValidationError(res, maxTokensError);
    return;
  }

  next();
}
