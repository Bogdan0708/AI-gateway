import client from "prom-client";

// Clear any previously registered metrics (safe for test re-imports)
// then collect default Node.js metrics (CPU, memory, event loop, GC, etc.)
client.register.clear();
client.collectDefaultMetrics();

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status_code"] as const,
});

export const httpRequestDurationMs = new client.Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "path", "status_code"] as const,
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
});

export const aiRequestsTotal = new client.Counter({
  name: "ai_requests_total",
  help: "Total AI completion/embedding requests by provider and outcome",
  labelNames: ["operation", "provider", "model", "status"] as const,
});

export const aiRequestDurationMs = new client.Histogram({
  name: "ai_request_duration_ms",
  help: "AI provider request duration in milliseconds",
  labelNames: ["operation", "provider", "model"] as const,
  buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
});

export const aiTokensTotal = new client.Counter({
  name: "ai_tokens_total",
  help: "Total tokens consumed by AI requests",
  labelNames: ["provider", "model", "token_type"] as const,
});

export const metricsRegistry = client.register;
