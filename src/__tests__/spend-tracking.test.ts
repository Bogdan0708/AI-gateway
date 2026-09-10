import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enforceSpendCap,
  getTenantTokenUsage,
  recordTenantTokenUsage,
  resetSpendTracking,
} from "../lib/spend-tracking";
import { TenantPolicyError } from "../lib/tenant-policy";

afterEach(() => {
  resetSpendTracking();
  vi.restoreAllMocks();
});

describe("spend tracking", () => {
  it("records and retrieves tenant token usage", () => {
    recordTenantTokenUsage("tenant-a", 500);
    recordTenantTokenUsage("tenant-a", 300);

    expect(getTenantTokenUsage("tenant-a")).toBe(800);
  });

  it("tracks tenants independently", () => {
    recordTenantTokenUsage("tenant-a", 100);
    recordTenantTokenUsage("tenant-b", 200);

    expect(getTenantTokenUsage("tenant-a")).toBe(100);
    expect(getTenantTokenUsage("tenant-b")).toBe(200);
  });

  it("returns 0 for unknown tenants", () => {
    expect(getTenantTokenUsage("unknown")).toBe(0);
  });

  it("ignores calls with no tenant or zero/negative tokens", () => {
    recordTenantTokenUsage(undefined, 100);
    recordTenantTokenUsage("tenant-a", 0);
    recordTenantTokenUsage("tenant-a", -5);

    expect(getTenantTokenUsage("tenant-a")).toBe(0);
  });

  it("resets usage on a new calendar month", () => {
    recordTenantTokenUsage("tenant-a", 1000);
    expect(getTenantTokenUsage("tenant-a")).toBe(1000);

    // Simulate month change by mocking Date
    const nextMonth = new Date();
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    vi.setSystemTime(nextMonth);

    expect(getTenantTokenUsage("tenant-a")).toBe(0);
  });
});

describe("enforceSpendCap", () => {
  it("does nothing when no tenant or no cap configured", () => {
    expect(() => enforceSpendCap(undefined, 1000)).not.toThrow();
    expect(() => enforceSpendCap("tenant-a", undefined)).not.toThrow();
  });

  it("allows requests under the cap", () => {
    recordTenantTokenUsage("tenant-a", 500);

    expect(() => enforceSpendCap("tenant-a", 1000)).not.toThrow();
  });

  it("throws TenantPolicyError when cap is reached", () => {
    recordTenantTokenUsage("tenant-a", 1000);

    expect(() => enforceSpendCap("tenant-a", 1000)).toThrow(TenantPolicyError);
    expect(() => enforceSpendCap("tenant-a", 1000)).toThrow(
      /reached its monthly token cap/,
    );
  });

  it("throws TenantPolicyError when cap is exceeded", () => {
    recordTenantTokenUsage("tenant-a", 1500);

    expect(() => enforceSpendCap("tenant-a", 1000)).toThrow(TenantPolicyError);
  });

  it("uses status code 429 and correct error code", () => {
    recordTenantTokenUsage("tenant-a", 1000);

    try {
      enforceSpendCap("tenant-a", 1000);
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TenantPolicyError);
      const policyError = error as TenantPolicyError;
      expect(policyError.statusCode).toBe(429);
      expect(policyError.code).toBe("tenant.spend_cap_reached");
    }
  });
});
