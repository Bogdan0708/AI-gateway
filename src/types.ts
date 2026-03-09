export type ProviderName =
  | "openai"
  | "claude"
  | "gemini"
  | "xai"
  | "groq"
  | "perplexity";

export interface CompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: CompletionMessage[];
  provider?: ProviderName | string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tenantId?: string;
  taskType?: string;
  allowFallback?: boolean;
  allowedProviders?: ProviderName[];
  allowedModels?: string[];
}

export interface CompletionResponse {
  content: string;
  provider: ProviderName;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
  provider?: ProviderName | string;
  tenantId?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  provider: ProviderName;
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

export interface ProviderConfig {
  name: ProviderName;
  enabled: boolean;
  defaultModel: string;
  models: string[];
  embeddingModels?: string[];
  defaultEmbeddingModel?: string;
  checkReadiness?: () => Promise<{
    ready: boolean;
    reason?: string;
  }>;
  embed?: (
    request: EmbeddingRequest & {
      model: string;
    },
  ) => Promise<EmbeddingResponse>;
  complete: (
    request: CompletionRequest & {
      model: string;
      maxTokens: number;
      temperature: number;
    },
  ) => Promise<CompletionResponse>;
}
