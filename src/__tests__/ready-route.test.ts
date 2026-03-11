import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReadyResponse } from "../index";

process.env.GATEWAY_MASTER_KEY = "test-key-for-unit-tests";

describe("buildReadyResponse", () => {
  const deps = {
    checkProviderReadiness: vi.fn(),
    listProviders: vi.fn(),
    getInflightCounts: vi.fn(),
    isAuthorizedRequest: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    deps.listProviders.mockReturnValue([
      {
        id: "openai",
        enabled: true,
        defaultModel: "gpt-4o-mini",
        models: ["gpt-4o-mini"],
      },
    ]);
    deps.getInflightCounts.mockReturnValue({ global: 0, tenants: {} });
    deps.checkProviderReadiness.mockResolvedValue([
      {
        id: "openai",
        enabled: true,
        ready: true,
        reason: "reachable (200)",
      },
    ]);
  });

  it("returns the minimal public readiness shape without provider diagnostics", async () => {
    deps.isAuthorizedRequest.mockReturnValue(false);

    const response = await buildReadyResponse({ headers: {} } as never, deps);

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("ready");
    expect(response.body.service).toBe("ai-gateway");
    expect(response.body.master_key_configured).toBeUndefined();
    expect(response.body.providers).toBeUndefined();
    expect(deps.checkProviderReadiness).not.toHaveBeenCalled();
  });

  it("returns authenticated provider diagnostics for authorized callers", async () => {
    deps.isAuthorizedRequest.mockReturnValue(true);

    const response = await buildReadyResponse({ headers: {} } as never, deps);

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("ready");
    expect(response.body.master_key_configured).toBe(true);
    expect(response.body.inflight).toEqual({ global: 0 });
    expect(response.body.providers).toEqual([
      {
        id: "openai",
        enabled: true,
        ready: true,
        reason: "reachable (200)",
      },
    ]);
    expect(deps.checkProviderReadiness).toHaveBeenCalledOnce();
  });

  it("returns 503 for authenticated callers when no enabled provider is ready", async () => {
    deps.isAuthorizedRequest.mockReturnValue(true);
    deps.checkProviderReadiness.mockResolvedValue([
      {
        id: "openai",
        enabled: true,
        ready: false,
        reason: "unexpected status (401)",
      },
    ]);

    const response = await buildReadyResponse({ headers: {} } as never, deps);

    expect(response.statusCode).toBe(503);
    expect(response.body.status).toBe("not_ready");
    expect(response.body.providers).toEqual([
      {
        id: "openai",
        enabled: true,
        ready: false,
        reason: "unexpected status (401)",
      },
    ]);
  });
});
