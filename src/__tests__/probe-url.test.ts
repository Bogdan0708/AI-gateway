import { afterEach, describe, expect, it, vi } from "vitest";
import { probeUrl } from "../lib/readiness";

describe("probeUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats 2xx as ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(probeUrl("https://example.com")).resolves.toEqual({
      ready: true,
      reason: "reachable (204)",
    });
  });

  it("treats 5xx as not ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(probeUrl("https://example.com")).resolves.toEqual({
      ready: false,
      reason: "unexpected status (503)",
    });
  });

  it("treats 4xx as not ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    await expect(probeUrl("https://example.com")).resolves.toEqual({
      ready: false,
      reason: "unexpected status (401)",
    });
  });
});
