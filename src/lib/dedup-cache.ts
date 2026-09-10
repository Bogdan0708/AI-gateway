import { createHash } from "node:crypto";
import { logger } from "./logger";

const DEFAULT_DEDUP_TTL_MS = 15_000;

interface InflightEntry<T> {
  promise: Promise<T>;
  createdAt: number;
}

export class DedupCache<T> {
  private readonly inflight = new Map<string, InflightEntry<T>>();
  private readonly ttlMs: number;

  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs ?? DEFAULT_DEDUP_TTL_MS;
  }

  /**
   * Generate a cache key from arbitrary JSON-serializable parts.
   * Uses SHA-256 to produce a fixed-length key.
   */
  static buildKey(...parts: unknown[]): string {
    const hash = createHash("sha256");
    hash.update(JSON.stringify(parts));
    return hash.digest("hex");
  }

  /**
   * Execute `operation` with dedup: if an identical key is already in-flight,
   * return the existing promise instead of starting a new one.
   * Returns `{ result, deduplicated }` so callers can log/metric the hit.
   */
  async dedup(
    key: string,
    operation: () => Promise<T>,
  ): Promise<{ result: T; deduplicated: boolean }> {
    this.evictStale();

    const existing = this.inflight.get(key);
    if (existing) {
      logger.debug({ dedupKey: key.slice(0, 12) }, "dedup cache hit — coalescing request");
      const result = await existing.promise;
      return { result, deduplicated: true };
    }

    const promise = operation();
    this.inflight.set(key, { promise, createdAt: Date.now() });

    try {
      const result = await promise;
      return { result, deduplicated: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  get size(): number {
    return this.inflight.size;
  }

  clear(): void {
    this.inflight.clear();
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.inflight) {
      if (now - entry.createdAt > this.ttlMs) {
        this.inflight.delete(key);
      }
    }
  }
}

function getDedupTtlMs(): number {
  const value = Number(process.env.DEDUP_CACHE_TTL_MS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_DEDUP_TTL_MS;
}

function isDedupEnabled(): boolean {
  return process.env.DEDUP_CACHE_ENABLED !== "false";
}

export const completionDedupCache = new DedupCache<unknown>(getDedupTtlMs());

export function buildCompletionDedupKey(request: {
  messages: Array<{ role: string; content: string }>;
  provider?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tenantId?: string;
  allowedProviders?: string[];
  allowedModels?: string[];
}): string {
  return DedupCache.buildKey(
    request.tenantId ?? "",
    request.provider ?? "",
    request.model ?? "",
    request.maxTokens ?? 2048,
    request.temperature ?? 0.7,
    request.allowedProviders ?? [],
    request.allowedModels ?? [],
    request.messages,
  );
}

export { isDedupEnabled };
