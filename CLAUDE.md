# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Gateway v3.0.0 — a multi-provider AI gateway service that provides a unified OpenAI-compatible API across six AI providers (OpenAI, Anthropic/Claude, Google/Gemini, xAI/Grok, Groq, Perplexity). Deployed on GCP Cloud Run.

## Commands

```bash
npm run build          # Compile TypeScript (tsc → dist/)
npm run dev            # Run with ts-node (development)
npm start              # Run compiled dist/index.js (production)
npm test               # Run tests once (vitest run)
npm run test:watch     # Run tests in watch mode (vitest)
npm run lint           # ESLint check (src/)
npm run lint:fix       # ESLint auto-fix
```

CI runs: type-check (`tsc --noEmit`) → lint → test → audit → build.

### Running a single test

```bash
npx vitest run src/__tests__/smoke.test.ts
```

## Architecture

### Entry Point & Server (`src/index.ts`)

Express server (port 8080) with this middleware stack in order:
1. Helmet (security headers)
2. CORS (configurable origins)
3. JSON body parser (1MB limit)
4. Pino HTTP logger
5. Bearer token auth (`GATEWAY_MASTER_KEY`)
6. Rate limiting (100 req/15 min)

Routes are defined inline in `index.ts`, not in separate route files. The file exports `app` (for testing with supertest) and gates `app.listen()` behind `require.main === module` to avoid EADDRINUSE in tests.

### Provider System (`src/providers/`)

Each provider file exports a `ProviderConfig` with `name`, `enabled`, `defaultModel`, `models[]`, and a `complete()` function. The registry in `providers/index.ts` manages all providers and implements the **fallback chain**: if the requested provider fails, it tries the next enabled provider in order: openai → claude → gemini → xai → groq → perplexity.

Key patterns:
- **Lazy client initialization** — SDK clients are only created when the provider's API key is present
- **30-second timeouts** via AbortController on every provider call
- **Message format conversion** — each provider adapts the unified `CompletionMessage[]` format to its native API (e.g., Claude splits out system messages; Gemini requires the last message to be from user)
- Provider is `enabled` based on whether its env var API key is set
- Perplexity uses raw `fetch()` (no SDK), all others use official SDKs

### Types (`src/types.ts`)

Core types: `ProviderName` (union of 6 provider strings), `CompletionRequest`, `CompletionResponse`, `CompletionMessage`, `ProviderConfig`.

### Middleware (`src/middleware/`)

- `auth.ts` — Bearer token validation using `timingSafeEqual`; skips `/health` and `/ping`
- `validate.ts` — Zod-based request body validation with `.passthrough()` (extra fields allowed); messages capped at 50, content at 32K chars, temperature 0–2, max_tokens 1–16384

### Logging (`src/lib/logger.ts`)

Pino structured JSON logger with `x-request-id` header extraction (or UUID generation). Log level from `LOG_LEVEL` env var.

## Testing

Tests use **vitest** + **supertest**. Test files live at `src/__tests__/*.test.ts` and are excluded from the TypeScript build via `tsconfig.json`.

Tests mock the provider layer (`vi.mock("../providers")`) to avoid real API calls. Set `GATEWAY_MASTER_KEY` in the test file before importing `app`.

## API Endpoints

- `POST /v1/chat/completions` — OpenAI-compatible chat completion (returns snake_case usage: `prompt_tokens`)
- `POST /complete` — Simplified completion (takes `prompt` + optional `system`; returns camelCase usage: `promptTokens`)
- `GET /health`, `GET /ping`, `GET /providers` — operational endpoints

## Environment Variables

- `GATEWAY_MASTER_KEY` — required for auth
- `PORT` (default: 8080), `NODE_ENV`, `LOG_LEVEL` (default: info), `CORS_ORIGINS` (comma-separated)
- Provider API keys (each enables its provider): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `PERPLEXITY_API_KEY`

## Build & Deploy

TypeScript compiles to ES2022 CommonJS in `dist/`. Dockerfile uses multi-stage build with `node:20-alpine` and runs as non-root user. Optimized for Cloud Run scale-to-zero.

## Lint Rules

ESLint uses `typescript-eslint` recommended config. Unused vars prefixed with `_` are allowed (`argsIgnorePattern: "^_"`).
