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

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 8080;

// =============================================================================
// Middleware
// =============================================================================

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || [
    // PrimărIA
    'https://primaria.ro',
    'https://*.primaria.ro',
    // Mitch Hospitality (legacy)
    'https://api.mitchfromtransylvania.com',
    'https://mitchfromtransylvania.com',
    // Local development
    'http://localhost:3000',
    'http://localhost:3006',
  ],
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// Request ID middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.headers['x-request-id'] = req.headers['x-request-id'] || uuidv4();
  next();
});

// =============================================================================
// AI Provider Configuration
// =============================================================================

interface ProviderConfig {
  name: string;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
  models: string[];
}

const providers: Record<string, ProviderConfig> = {
  openai: {
    name: 'OpenAI',
    enabled: !!process.env.OPENAI_API_KEY,
    apiKey: process.env.OPENAI_API_KEY,
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
  },
  claude: {
    name: 'Anthropic Claude',
    enabled: !!process.env.ANTHROPIC_API_KEY,
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229']
  },
  perplexity: {
    name: 'Perplexity',
    enabled: !!process.env.PERPLEXITY_API_KEY,
    apiKey: process.env.PERPLEXITY_API_KEY,
    defaultModel: 'sonar',
    models: ['sonar', 'sonar-pro', 'sonar-reasoning']
  },
  gemini: {
    name: 'Google Gemini',
    enabled: !!process.env.GOOGLE_API_KEY,
    apiKey: process.env.GOOGLE_API_KEY,
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro-latest']
  }
};

// Provider priority for fallback
const providerPriority = ['openai', 'claude', 'gemini', 'perplexity'];

// =============================================================================
// AI Completion Logic
// =============================================================================

interface CompletionRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  provider?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tenantId?: string;
  taskType?: string;
}

interface CompletionResponse {
  content: string;
  provider: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

async function completeWithOpenAI(
  messages: CompletionRequest['messages'],
  model: string,
  maxTokens: number,
  temperature: number
): Promise<CompletionResponse> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: providers.openai.apiKey });
  
  const start = Date.now();
  const response = await client.chat.completions.create({
    model,
    messages,
    max_tokens: maxTokens,
    temperature
  });
  
  return {
    content: response.choices[0]?.message?.content || '',
    provider: 'openai',
    model,
    usage: {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0
    },
    latencyMs: Date.now() - start
  };
}

async function completeWithClaude(
  messages: CompletionRequest['messages'],
  model: string,
  maxTokens: number,
  temperature: number
): Promise<CompletionResponse> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: providers.claude.apiKey });
  
  // Extract system message
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const chatMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  
  const start = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemMsg,
    messages: chatMessages
  });
  
  const textContent = response.content.find(c => c.type === 'text');
  
  return {
    content: textContent?.text || '',
    provider: 'claude',
    model,
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens
    },
    latencyMs: Date.now() - start
  };
}

async function completeWithGemini(
  messages: CompletionRequest['messages'],
  model: string,
  maxTokens: number,
  temperature: number
): Promise<CompletionResponse> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(providers.gemini.apiKey!);
  const geminiModel = genAI.getGenerativeModel({ model });
  
  // Convert messages to Gemini format
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const chatMessages = messages.filter(m => m.role !== 'system');
  
  const prompt = chatMessages.map(m => 
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
  ).join('\n\n');
  
  const fullPrompt = systemMsg ? `${systemMsg}\n\n${prompt}` : prompt;
  
  const start = Date.now();
  const result = await geminiModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature
    }
  });
  
  const response = result.response;
  const text = response.text();
  
  // Estimate tokens (Gemini doesn't always return usage)
  const estimatedPromptTokens = Math.ceil(fullPrompt.length / 4);
  const estimatedCompletionTokens = Math.ceil(text.length / 4);
  
  return {
    content: text,
    provider: 'gemini',
    model,
    usage: {
      promptTokens: estimatedPromptTokens,
      completionTokens: estimatedCompletionTokens,
      totalTokens: estimatedPromptTokens + estimatedCompletionTokens
    },
    latencyMs: Date.now() - start
  };
}

async function completeWithPerplexity(
  messages: CompletionRequest['messages'],
  model: string,
  maxTokens: number,
  temperature: number
): Promise<CompletionResponse> {
  const start = Date.now();
  
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${providers.perplexity.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Perplexity] Error ${response.status}: ${errorText}`);
    throw new Error(`Perplexity API error: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json() as {
    choices: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  
  return {
    content: data.choices[0]?.message?.content || '',
    provider: 'perplexity',
    model,
    usage: {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0
    },
    latencyMs: Date.now() - start
  };
}

async function complete(request: CompletionRequest): Promise<CompletionResponse> {
  const {
    messages,
    provider: requestedProvider,
    model: requestedModel,
    maxTokens = 2048,
    temperature = 0.7
  } = request;
  
  // Determine provider order
  let providerOrder = [...providerPriority];
  if (requestedProvider && providers[requestedProvider]?.enabled) {
    providerOrder = [requestedProvider, ...providerOrder.filter(p => p !== requestedProvider)];
  }
  
  // Filter to enabled providers
  providerOrder = providerOrder.filter(p => providers[p]?.enabled);
  
  if (providerOrder.length === 0) {
    throw new Error('No AI providers configured');
  }
  
  // Try providers in order
  let lastError: Error | null = null;
  
  for (const providerName of providerOrder) {
    const config = providers[providerName];
    const model = requestedModel && config.models.includes(requestedModel) 
      ? requestedModel 
      : config.defaultModel;
    
    try {
      console.log(`[AI] Trying ${providerName} with model ${model}`);
      
      switch (providerName) {
        case 'openai':
          return await completeWithOpenAI(messages, model, maxTokens, temperature);
        case 'claude':
          return await completeWithClaude(messages, model, maxTokens, temperature);
        case 'gemini':
          return await completeWithGemini(messages, model, maxTokens, temperature);
        case 'perplexity':
          return await completeWithPerplexity(messages, model, maxTokens, temperature);
        default:
          continue;
      }
    } catch (error) {
      console.error(`[AI] ${providerName} failed:`, error);
      lastError = error as Error;
      continue;
    }
  }
  
  throw lastError || new Error('All AI providers failed');
}

// =============================================================================
// Routes
// =============================================================================

// Health check (before CORS for ALB)
app.get('/health', (_req: Request, res: Response) => {
  const enabledProviders = Object.entries(providers)
    .filter(([_, config]) => config.enabled)
    .map(([name]) => name);
  
  res.json({
    status: 'healthy',
    service: 'ai-gateway',
    version: '2.0.0',
    providers: enabledProviders,
    timestamp: new Date().toISOString()
  });
});

app.get('/ping', (_req: Request, res: Response) => {
  res.send('pong');
});

// Provider status
app.get('/providers', (_req: Request, res: Response) => {
  const status = Object.entries(providers).map(([id, config]) => ({
    id,
    name: config.name,
    enabled: config.enabled,
    defaultModel: config.defaultModel,
    models: config.models
  }));
  
  res.json({ providers: status });
});

// Chat completion
app.post('/v1/chat/completions', async (req: Request, res: Response) => {
  try {
    const { messages, provider, model, max_tokens, temperature, tenant_id, task_type } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }
    
    const result = await complete({
      messages,
      provider,
      model,
      maxTokens: max_tokens,
      temperature,
      tenantId: tenant_id,
      taskType: task_type
    });
    
    // Log usage
    console.log(`[AI] Completed: provider=${result.provider} model=${result.model} tokens=${result.usage.totalTokens} latency=${result.latencyMs}ms`);
    
    res.json({
      id: `chatcmpl-${uuidv4()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: result.model,
      provider: result.provider,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: result.content
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.totalTokens
      },
      latency_ms: result.latencyMs
    });
  } catch (error) {
    console.error('[AI] Completion error:', error);
    res.status(500).json({
      error: {
        message: error instanceof Error ? error.message : 'AI completion failed',
        type: 'ai_error'
      }
    });
  }
});

// Simple completion endpoint (convenience)
app.post('/complete', async (req: Request, res: Response) => {
  try {
    const { prompt, system, provider, model, max_tokens, temperature } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'prompt required' });
    }
    
    const messages: CompletionRequest['messages'] = [];
    if (system) {
      messages.push({ role: 'system', content: system });
    }
    messages.push({ role: 'user', content: prompt });
    
    const result = await complete({
      messages,
      provider,
      model,
      maxTokens: max_tokens,
      temperature
    });
    
    res.json({
      content: result.content,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      latency_ms: result.latencyMs
    });
  } catch (error) {
    console.error('[AI] Completion error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'AI completion failed'
    });
  }
});

// =============================================================================
// Error Handler
// =============================================================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err);
  res.status(500).json({
    error: {
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      type: 'server_error'
    }
  });
});

// =============================================================================
// Start Server
// =============================================================================

app.listen(PORT, () => {
  console.log(`🤖 AI Gateway running on port ${PORT}`);
  console.log(`📊 Enabled providers: ${Object.entries(providers).filter(([_, c]) => c.enabled).map(([n]) => n).join(', ') || 'none'}`);
});

export default app;
