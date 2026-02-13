/**
 * AI Gateway — Multi-Provider AI Service
 *
 * Shared AI microservice for all projects:
 * - Multi-provider LLM routing (OpenAI, Claude, Perplexity, Gemini)
 * - Automatic fallback between providers
 * - OpenAI-compatible API (/v1/chat/completions)
 * - Health monitoring
 *
 * Used by: PrimărIA, Mitch Hospitality, EU Funds Manager
 */
declare const app: import("express-serve-static-core").Express;
export default app;
//# sourceMappingURL=index.d.ts.map