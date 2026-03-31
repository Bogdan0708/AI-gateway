import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DedupCache,
  buildCompletionDedupKey,
} from "../lib/dedup-cache";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DedupCache", () => {
  it("coalesces concurrent identical requests", async () => {
    const cache = new DedupCache<string>();
    let callCount = 0;

    let resolve!: (value: string) => void;
    const blockingPromise = new Promise<string>((r) => {
      resolve = r;
    });

    const operation = () => {
      callCount += 1;
      return blockingPromise;
    };

    const key = "test-key";
    const first = cache.dedup(key, operation);
    const second = cache.dedup(key, operation);

    resolve("hello");

    const [r1, r2] = await Promise.all([first, second]);

    expect(callCount).toBe(1);
    expect(r1).toEqual({ result: "hello", deduplicated: false });
    expect(r2).toEqual({ result: "hello", deduplicated: true });
  });

  it("does not coalesce requests with different keys", async () => {
    const cache = new DedupCache<string>();
    let callCount = 0;

    const operation = async () => {
      callCount += 1;
      return `result-${callCount}`;
    };

    const [r1, r2] = await Promise.all([
      cache.dedup("key-a", operation),
      cache.dedup("key-b", operation),
    ]);

    expect(callCount).toBe(2);
    expect(r1.deduplicated).toBe(false);
    expect(r2.deduplicated).toBe(false);
  });

  it("cleans up cache entry after completion", async () => {
    const cache = new DedupCache<string>();

    await cache.dedup("key", async () => "done");
    expect(cache.size).toBe(0);
  });

  it("cleans up cache entry after error", async () => {
    const cache = new DedupCache<string>();

    await expect(
      cache.dedup("key", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(cache.size).toBe(0);
  });

  it("propagates errors to all coalesced callers", async () => {
    const cache = new DedupCache<string>();

    let reject!: (err: Error) => void;
    const blockingPromise = new Promise<string>((_, r) => {
      reject = r;
    });

    const key = "error-key";
    const first = cache.dedup(key, () => blockingPromise);
    const second = cache.dedup(key, () => blockingPromise);

    reject(new Error("provider failed"));

    await expect(first).rejects.toThrow("provider failed");
    await expect(second).rejects.toThrow("provider failed");
  });

  it("evicts stale entries based on TTL", async () => {
    const cache = new DedupCache<string>(50);

    let resolve!: (value: string) => void;
    const slowPromise = new Promise<string>((r) => {
      resolve = r;
    });

    const first = cache.dedup("stale-key", () => slowPromise);
    expect(cache.size).toBe(1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 60));

    // New dedup call should not coalesce (stale entry evicted)
    let secondCallCount = 0;
    const second = cache.dedup("stale-key", async () => {
      secondCallCount += 1;
      return "fresh";
    });

    const r2 = await second;
    expect(r2).toEqual({ result: "fresh", deduplicated: false });
    expect(secondCallCount).toBe(1);

    // Resolve the original so it doesn't hang
    resolve("old");
    await first;
  });

  it("allows new requests after previous one completes", async () => {
    const cache = new DedupCache<string>();
    let callCount = 0;

    const operation = async () => {
      callCount += 1;
      return `result-${callCount}`;
    };

    const r1 = await cache.dedup("key", operation);
    const r2 = await cache.dedup("key", operation);

    expect(callCount).toBe(2);
    expect(r1.result).toBe("result-1");
    expect(r2.result).toBe("result-2");
  });
});

describe("buildCompletionDedupKey", () => {
  it("produces consistent keys for identical requests", () => {
    const request = {
      messages: [{ role: "user" as const, content: "hello" }],
      provider: "openai",
      model: "gpt-4",
      maxTokens: 2048,
      temperature: 0.7,
      tenantId: "tenant-1",
    };

    const key1 = buildCompletionDedupKey(request);
    const key2 = buildCompletionDedupKey(request);
    expect(key1).toBe(key2);
  });

  it("produces different keys for different messages", () => {
    const base = {
      messages: [{ role: "user" as const, content: "hello" }],
      provider: "openai",
    };

    const key1 = buildCompletionDedupKey(base);
    const key2 = buildCompletionDedupKey({
      ...base,
      messages: [{ role: "user" as const, content: "goodbye" }],
    });

    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different tenants", () => {
    const base = {
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const key1 = buildCompletionDedupKey({ ...base, tenantId: "tenant-a" });
    const key2 = buildCompletionDedupKey({ ...base, tenantId: "tenant-b" });

    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different temperatures", () => {
    const base = {
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const key1 = buildCompletionDedupKey({ ...base, temperature: 0.5 });
    const key2 = buildCompletionDedupKey({ ...base, temperature: 1.0 });

    expect(key1).not.toBe(key2);
  });
});
