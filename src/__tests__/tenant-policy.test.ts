import { afterEach, describe, expect, it } from "vitest";
import {
  enforceTenantPolicy,
  filterProvidersForTenant,
  loadTenantPolicyConfig,
  resolveTenantId,
  TenantPolicyError,
} from "../lib/tenant-policy";

const originalRequireTenantId = process.env.REQUIRE_TENANT_ID;
const originalPolicies = process.env.TENANT_POLICIES_JSON;

afterEach(() => {
  if (originalRequireTenantId === undefined) {
    delete process.env.REQUIRE_TENANT_ID;
  } else {
    process.env.REQUIRE_TENANT_ID = originalRequireTenantId;
  }

  if (originalPolicies === undefined) {
    delete process.env.TENANT_POLICIES_JSON;
  } else {
    process.env.TENANT_POLICIES_JSON = originalPolicies;
  }
});

describe("tenant policy", () => {
  it("requires a tenant id when configured", () => {
    process.env.REQUIRE_TENANT_ID = "true";
    delete process.env.TENANT_POLICIES_JSON;

    expect(() => enforceTenantPolicy({})).toThrow(TenantPolicyError);
  });

  it("rejects mismatched tenant ids between header and body", () => {
    expect(() => resolveTenantId("tenant-a", "tenant-b")).toThrow(
      "Tenant ID mismatch",
    );
  });

  it("enforces per-tenant provider and token policies", () => {
    process.env.TENANT_POLICIES_JSON = JSON.stringify({
      "tenant-a": {
        allowedProviders: ["openai"],
        allowedModels: ["gpt-4o-mini"],
        maxTokens: 512,
      },
    });

    expect(() =>
      enforceTenantPolicy({
        tenantId: "tenant-a",
        provider: "claude",
      }),
    ).toThrow("Provider claude is not allowed");

    expect(() =>
      enforceTenantPolicy({
        tenantId: "tenant-a",
        maxTokens: 1024,
      }),
    ).toThrow("max_tokens exceeds tenant limit");
  });

  it("attaches stable codes to tenant policy errors", () => {
    process.env.REQUIRE_TENANT_ID = "true";

    expect(() => enforceTenantPolicy({})).toThrowError(
      expect.objectContaining({
        code: "tenant.required",
      }),
    );
  });

  it("filters provider discovery by tenant policy", () => {
    process.env.TENANT_POLICIES_JSON = JSON.stringify({
      "tenant-a": {
        allowedProviders: ["openai"],
        allowedModels: ["gpt-4o-mini"],
      },
    });

    const providers = filterProvidersForTenant({
      tenantId: "tenant-a",
      providers: [
        {
          id: "openai",
          enabled: true,
          defaultModel: "gpt-4o-mini",
          models: ["gpt-4o-mini", "gpt-4o"],
        },
        {
          id: "claude",
          enabled: true,
          defaultModel: "claude-sonnet-4-20250514",
          models: ["claude-sonnet-4-20250514"],
        },
      ],
    });

    expect(providers).toEqual([
      {
        id: "openai",
        enabled: true,
        defaultModel: "gpt-4o-mini",
        models: ["gpt-4o-mini"],
      },
    ]);
  });

  it("loads an empty policy config when unset", () => {
    delete process.env.REQUIRE_TENANT_ID;
    delete process.env.TENANT_POLICIES_JSON;

    expect(loadTenantPolicyConfig()).toEqual({
      requireTenantId: false,
      policies: {},
    });
  });
});
