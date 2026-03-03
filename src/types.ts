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

export interface ProviderConfig {
  name: ProviderName;
  enabled: boolean;
  defaultModel: string;
  models: string[];
  complete: (
    request: CompletionRequest & {
      model: string;
      maxTokens: number;
      temperature: number;
    },
  ) => Promise<CompletionResponse>;
}
