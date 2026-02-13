"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const uuid_1 = require("uuid");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 8080;
// =============================================================================
// Middleware
// =============================================================================
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
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
app.use(express_1.default.json({ limit: '1mb' }));
// Request ID middleware
app.use((req, _res, next) => {
    req.headers['x-request-id'] = req.headers['x-request-id'] || (0, uuid_1.v4)();
    next();
});
const providers = {
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
async function completeWithOpenAI(messages, model, maxTokens, temperature) {
    const { default: OpenAI } = await Promise.resolve().then(() => __importStar(require('openai')));
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
async function completeWithClaude(messages, model, maxTokens, temperature) {
    const Anthropic = (await Promise.resolve().then(() => __importStar(require('@anthropic-ai/sdk')))).default;
    const client = new Anthropic({ apiKey: providers.claude.apiKey });
    // Extract system message
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));
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
async function completeWithGemini(messages, model, maxTokens, temperature) {
    const { GoogleGenerativeAI } = await Promise.resolve().then(() => __importStar(require('@google/generative-ai')));
    const genAI = new GoogleGenerativeAI(providers.gemini.apiKey);
    const geminiModel = genAI.getGenerativeModel({ model });
    // Convert messages to Gemini format
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages.filter(m => m.role !== 'system');
    const prompt = chatMessages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
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
async function completeWithPerplexity(messages, model, maxTokens, temperature) {
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
    const data = await response.json();
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
async function complete(request) {
    const { messages, provider: requestedProvider, model: requestedModel, maxTokens = 2048, temperature = 0.7 } = request;
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
    let lastError = null;
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
        }
        catch (error) {
            console.error(`[AI] ${providerName} failed:`, error);
            lastError = error;
            continue;
        }
    }
    throw lastError || new Error('All AI providers failed');
}
// =============================================================================
// Routes
// =============================================================================
// Health check (before CORS for ALB)
app.get('/health', (_req, res) => {
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
app.get('/ping', (_req, res) => {
    res.send('pong');
});
// Provider status
app.get('/providers', (_req, res) => {
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
app.post('/v1/chat/completions', async (req, res) => {
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
            id: `chatcmpl-${(0, uuid_1.v4)()}`,
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
    }
    catch (error) {
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
app.post('/complete', async (req, res) => {
    try {
        const { prompt, system, provider, model, max_tokens, temperature } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'prompt required' });
        }
        const messages = [];
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
    }
    catch (error) {
        console.error('[AI] Completion error:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'AI completion failed'
        });
    }
});
// =============================================================================
// Error Handler
// =============================================================================
app.use((err, _req, res, _next) => {
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
exports.default = app;
//# sourceMappingURL=index.js.map