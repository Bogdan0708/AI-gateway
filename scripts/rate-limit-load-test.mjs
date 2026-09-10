#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const BASE_URL = process.env.BASE_URL || "http://localhost:8080";
const ENDPOINT = process.env.ENDPOINT || "/providers";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const TENANT_ID =
  process.env.TENANT_ID ||
  `load-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const PRE_TOTAL = Number(process.env.PRE_TOTAL || 20);
const PRE_CONCURRENCY = Number(process.env.PRE_CONCURRENCY || 5);
const BURST_TOTAL = Number(process.env.BURST_TOTAL || 120);
const BURST_CONCURRENCY = Number(process.env.BURST_CONCURRENCY || 30);

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const EXPECT_429 = (process.env.EXPECT_429 || "true").toLowerCase() !== "false";

if (!AUTH_TOKEN) {
  console.error("AUTH_TOKEN is required.");
  process.exit(1);
}

if (!Number.isFinite(PRE_TOTAL) || !Number.isFinite(BURST_TOTAL)) {
  console.error("PRE_TOTAL and BURST_TOTAL must be numeric.");
  process.exit(1);
}

if (!Number.isFinite(PRE_CONCURRENCY) || !Number.isFinite(BURST_CONCURRENCY)) {
  console.error("PRE_CONCURRENCY and BURST_CONCURRENCY must be numeric.");
  process.exit(1);
}

const target = `${BASE_URL.replace(/\/$/, "")}${ENDPOINT.startsWith("/") ? ENDPOINT : `/${ENDPOINT}`}`;

function buildHeaders() {
  return {
    authorization: `Bearer ${AUTH_TOKEN}`,
    "x-tenant-id": TENANT_ID,
    accept: "application/json",
  };
}

async function sendRequest() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const res = await fetch(target, {
      method: "GET",
      headers: buildHeaders(),
      signal: controller.signal,
    });

    await res.arrayBuffer();

    return {
      ok: true,
      status: res.status,
      latencyMs: performance.now() - startedAt,
      rateLimit: res.headers.get("ratelimit"),
      rateLimitPolicy: res.headers.get("ratelimit-policy"),
      retryAfter: res.headers.get("retry-after"),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      rateLimit: null,
      rateLimitPolicy: null,
      retryAfter: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runBurst(total, concurrency, label) {
  const counts = new Map();
  const latencies = [];
  const errors = [];
  let requestIndex = 0;
  let lastRateLimit = null;
  let lastRateLimitPolicy = null;
  let lastRetryAfter = null;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      requestIndex += 1;
      const current = requestIndex;
      if (current > total) {
        return;
      }

      const result = await sendRequest();
      latencies.push(result.latencyMs);

      if (result.rateLimit) {
        lastRateLimit = result.rateLimit;
      }
      if (result.rateLimitPolicy) {
        lastRateLimitPolicy = result.rateLimitPolicy;
      }
      if (result.retryAfter) {
        lastRetryAfter = result.retryAfter;
      }

      if (!result.ok) {
        errors.push(result.error || "unknown error");
      }

      const prev = counts.get(result.status) || 0;
      counts.set(result.status, prev + 1);
    }
  });

  const start = performance.now();
  await Promise.all(workers);
  const durationMs = performance.now() - start;

  latencies.sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);

  return {
    label,
    total,
    concurrency,
    durationMs,
    requestsPerSecond: total / (durationMs / 1000),
    statusCounts: Object.fromEntries([...counts.entries()].sort((a, b) => a[0] - b[0])),
    p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)] || 0,
    p95LatencyMs: latencies[p95Index] || 0,
    maxLatencyMs: latencies[latencies.length - 1] || 0,
    networkErrors: errors.length,
    sampleError: errors[0] || null,
    rateLimitHeaders: {
      ratelimit: lastRateLimit,
      policy: lastRateLimitPolicy,
      retryAfter: lastRetryAfter,
    },
  };
}

function statusCount(result, status) {
  return result.statusCounts[String(status)] || 0;
}

async function main() {
  console.log(`Target: ${target}`);
  console.log(`Tenant key: ${TENANT_ID}`);
  console.log("Running pre-limit phase...");

  const pre = await runBurst(PRE_TOTAL, PRE_CONCURRENCY, "pre-limit");

  console.log("Running burst phase...");
  const burst = await runBurst(BURST_TOTAL, BURST_CONCURRENCY, "burst");

  const summary = {
    config: {
      baseUrl: BASE_URL,
      endpoint: ENDPOINT,
      tenantId: TENANT_ID,
      pre: { total: PRE_TOTAL, concurrency: PRE_CONCURRENCY },
      burst: { total: BURST_TOTAL, concurrency: BURST_CONCURRENCY },
      expect429: EXPECT_429,
    },
    pre,
    burst,
  };

  console.log(JSON.stringify(summary, null, 2));

  const pre429 = statusCount(pre, 429);
  const burst429 = statusCount(burst, 429);

  if (pre.networkErrors > 0 || burst.networkErrors > 0) {
    console.error("Validation failed: network errors occurred.");
    process.exit(1);
  }

  if (pre429 > 0) {
    console.error(`Validation failed: pre-limit phase returned ${pre429} HTTP 429 responses.`);
    process.exit(1);
  }

  if (EXPECT_429 && burst429 === 0) {
    console.error("Validation failed: burst phase did not trigger HTTP 429 responses.");
    process.exit(1);
  }

  console.log("Rate limit validation passed.");
}

main().catch((error) => {
  console.error("Load test failed:", error);
  process.exit(1);
});
