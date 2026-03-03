# AI Gateway v3.0.0

Multi-provider AI Gateway — a unified, secure, and high-performance middleware for all Bogdan projects. 

This service acts as a single point of entry for multiple AI providers, handling authentication, validation, and standardized request/response formats.

## 🚀 Features

- **Multi-Provider Support**: Seamlessly switch between or use multiple LLM providers.
- **Unified API**: OpenAI-compatible chat completion endpoints.
- **Security First**: 
  - Token-based authentication via `GATEWAY_MASTER_KEY`.
  - Security headers with `helmet`.
  - CORS configuration for multi-tenant support.
  - Rate limiting to prevent abuse.
- **Production Ready**: 
  - Optimized for **GCP Cloud Run** (Docker support).
  - Fast cold starts and small image footprint.
  - Health and monitoring endpoints.
  - Structured logging with `pino`.

## 🛠️ Supported Providers

- **OpenAI** (GPT-4o, GPT-3.5-Turbo)
- **Anthropic** (Claude 3.5 Sonnet, Claude 3 Opus)
- **Google** (Gemini 1.5 Pro/Flash)
- **xAI** (Grok)
- **Groq** (Llama 3, Mixtral)
- **Perplexity** (Online search models)

## 🔧 Environment Variables

The gateway requires the following environment variables to function:

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 8080) |
| `GATEWAY_MASTER_KEY` | Bearer token required for all authenticated routes |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `OPENAI_API_KEY` | (Optional) Enables OpenAI provider |
| `ANTHROPIC_API_KEY` | (Optional) Enables Claude provider |
| `GOOGLE_API_KEY` | (Optional) Enables Gemini provider |
| `XAI_API_KEY` | (Optional) Enables xAI Grok provider |
| `GROQ_API_KEY` | (Optional) Enables Groq provider |
| `PERPLEXITY_API_KEY` | (Optional) Enables Perplexity provider |

## 📦 Getting Started

### Local Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Build & Production

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

## 🐳 Docker

The project includes a multi-stage `Dockerfile` optimized for Cloud Run.

```bash
docker build -t ai-gateway .
docker run -p 8080:8080 --env-file .env ai-gateway
```

## 📡 API Endpoints

- `GET /health`: Service status and enabled providers.
- `GET /providers`: Detailed list of available models and configurations.
- `POST /v1/chat/completions`: OpenAI-compatible chat completion.
- `POST /complete`: Simplified completion endpoint.

---
*Maintained by Bogdan — Part of the Mitch From Transylvania ecosystem.*
