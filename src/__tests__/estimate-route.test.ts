import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("/v1/estimate route", () => {
  const TEST_KEY = "test-gateway-key-estimate";

  beforeEach(() => {
    vi.resetModules();
    process.env.GATEWAY_MASTER_KEY = TEST_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GATEWAY_MASTER_KEY;
  });

  function mockDeps() {
    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      child: vi.fn(),
    };
    mockLog.child.mockReturnValue(mockLog);

    vi.doMock("../lib/logger", () => ({
      logger: mockLog,
      httpLogger: (
        req: { log?: typeof mockLog },
        _res: unknown,
        next: () => void,
      ) => {
        req.log = mockLog;
        next();
      },
    }));

    vi.doMock("../providers", () => ({
      checkProviderReadiness: vi.fn(),
      complete: vi.fn(),
      completeStream: vi.fn(),
      CompletionRoutingError: class extends Error {
        statusCode = 400;
        code = "routing.unsupported_provider";
      },
      embed: vi.fn(),
      listProviders: vi.fn(() => []),
      resolveCompletionTarget: vi.fn(() => ({
        provider: "openai",
        model: "gpt-4o-mini",
      })),
    }));

    vi.doMock("../lib/tenant-policy", () => ({
      enforceTenantPolicy: vi.fn((input: Record<string, unknown>) => input),
      filterProvidersForTenant: vi.fn((input: { providers: unknown[] }) => input.providers),
      resolveTenantId: vi.fn(() => undefined),
      TenantPolicyError: class extends Error {
        statusCode = 403;
        code = "tenant.forbidden";
      },
    }));

    vi.doMock("../lib/concurrency", () => ({
      ConcurrencyLimitError: class extends Error {
        statusCode = 429;
        code = "concurrency.limit";
      },
      getInflightCounts: vi.fn(() => ({ global: 0 })),
      withConcurrencyLimit: vi.fn(
        (_tenantId: string | undefined, fn: () => Promise<unknown>) => fn(),
      ),
    }));
  }

  it("returns an estimate response for chat-like payloads", async () => {
    mockDeps();

    const request = (await import("supertest")).default;
    const { app } = await import("../index");

    const res = await request(app)
      .post("/v1/estimate")
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .send({
        messages: [{ role: "user", content: "Estimate this prompt please." }],
        max_tokens: 100,
      });

    expect(res.status).toBe(200);
    expect(res.body.object).toBe("estimate");
    expect(res.body.provider).toBe("openai");
    expect(res.body.model).toBe("gpt-4o-mini");
    expect(res.body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(res.body.usage.completion_tokens).toBe(100);
    expect(res.body.usage.total_tokens).toBe(
      res.body.usage.prompt_tokens + res.body.usage.completion_tokens,
    );
    expect(res.body.cost.usd).toBeGreaterThan(0);
    expect(res.body.pricing.input_per_1k_usd).toBeGreaterThan(0);
  });
});
