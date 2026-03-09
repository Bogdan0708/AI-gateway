import { afterEach, describe, expect, it } from "vitest";
import {
  ConcurrencyLimitError,
  getInflightCounts,
  withConcurrencyLimit,
} from "../lib/concurrency";

const originalGlobalLimit = process.env.MAX_CONCURRENT_REQUESTS;
const originalTenantPolicies = process.env.TENANT_POLICIES_JSON;

afterEach(() => {
  if (originalGlobalLimit === undefined) {
    delete process.env.MAX_CONCURRENT_REQUESTS;
  } else {
    process.env.MAX_CONCURRENT_REQUESTS = originalGlobalLimit;
  }

  if (originalTenantPolicies === undefined) {
    delete process.env.TENANT_POLICIES_JSON;
  } else {
    process.env.TENANT_POLICIES_JSON = originalTenantPolicies;
  }
});

describe("concurrency controls", () => {
  it("enforces the global concurrency limit", async () => {
    process.env.MAX_CONCURRENT_REQUESTS = "1";

    let release!: () => void;
    const blockingPromise = withConcurrencyLimit(undefined, async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "done";
    });

    await expect(
      withConcurrencyLimit(undefined, async () => "second"),
    ).rejects.toMatchObject({
      name: "ConcurrencyLimitError",
      statusCode: 503,
      message: "Global concurrency limit reached (1)",
    } satisfies Partial<ConcurrencyLimitError>);

    release();
    await expect(blockingPromise).resolves.toBe("done");
  });

  it("enforces tenant-specific concurrency limits", async () => {
    process.env.MAX_CONCURRENT_REQUESTS = "5";
    process.env.TENANT_POLICIES_JSON = JSON.stringify({
      "tenant-a": {
        maxConcurrentRequests: 1,
      },
    });

    let release!: () => void;
    const blockingPromise = withConcurrencyLimit("tenant-a", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "done";
    });

    await expect(
      withConcurrencyLimit("tenant-a", async () => "second"),
    ).rejects.toMatchObject({
      name: "ConcurrencyLimitError",
      statusCode: 429,
      message: "Tenant concurrency limit reached (1)",
    } satisfies Partial<ConcurrencyLimitError>);

    release();
    await expect(blockingPromise).resolves.toBe("done");
  });

  it("releases inflight counters after completion", async () => {
    process.env.MAX_CONCURRENT_REQUESTS = "2";

    await withConcurrencyLimit("tenant-a", async () => {
      expect(getInflightCounts()).toEqual({
        global: 1,
        tenants: { "tenant-a": 1 },
      });
    });

    expect(getInflightCounts()).toEqual({
      global: 0,
      tenants: {},
    });
  });
});
