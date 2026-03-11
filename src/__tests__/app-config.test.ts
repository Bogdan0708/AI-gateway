import { describe, expect, it, vi } from "vitest";

vi.mock("../providers", () => ({
  complete: vi.fn(),
  CompletionRoutingError: class CompletionRoutingError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
      super(message);
      this.name = "CompletionRoutingError";
      this.statusCode = statusCode;
    }
  },
  listProviders: vi.fn(() => []),
}));

process.env.GATEWAY_MASTER_KEY = "test-key-for-unit-tests";

import { app, getRateLimitKey } from "../index";

describe("app configuration", () => {
  it("trusts the first proxy hop for Cloud Run", () => {
    expect(app.get("trust proxy")).toBe(1);
  });

  it("keys rate limits by tenant when tenant identity is present", () => {
    expect(
      getRateLimitKey({
        headers: { "x-tenant-id": "tenant-a" },
        ip: "127.0.0.1",
      } as never),
    ).toBe("tenant:tenant-a");
  });

  it("falls back to IP-based rate limiting for malformed tenant identity", () => {
    expect(
      getRateLimitKey({
        headers: { "x-tenant-id": "bad tenant id" },
        ip: "127.0.0.1",
      } as never),
    ).toBe("ip:127.0.0.1");
  });
});
