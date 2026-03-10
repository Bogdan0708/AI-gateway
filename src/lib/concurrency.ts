import { ErrorCodes, type ErrorCode } from "./error-codes";
import { loadTenantPolicyConfig } from "./tenant-policy";

const DEFAULT_MAX_CONCURRENT_REQUESTS = 50;

interface TenantConcurrencyConfig {
  maxConcurrentRequests?: number;
}

interface InflightCounters {
  global: number;
  tenants: Map<string, number>;
}

export class ConcurrencyLimitError extends Error {
  public readonly code: ErrorCode;

  constructor(
    message: string,
    public readonly statusCode: number = 429,
    code: ErrorCode = ErrorCodes.concurrencyTenantLimitReached,
  ) {
    super(message);
    this.name = "ConcurrencyLimitError";
    this.code = code;
  }
}

const inflight: InflightCounters = {
  global: 0,
  tenants: new Map(),
};

function getGlobalLimit(): number {
  const value = Number(process.env.MAX_CONCURRENT_REQUESTS);
  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_CONCURRENT_REQUESTS;
}

function getTenantLimit(tenantId?: string): number | undefined {
  if (!tenantId) {
    return undefined;
  }

  const parsed = loadTenantPolicyConfig().policies as Record<
    string,
    TenantConcurrencyConfig
  >;
  const limit = parsed?.[tenantId]?.maxConcurrentRequests;
  return Number.isInteger(limit) && limit && limit > 0 ? limit : undefined;
}

export function getInflightCounts() {
  return {
    global: inflight.global,
    tenants: Object.fromEntries(inflight.tenants.entries()),
  };
}

export function resetInflightCounts(): void {
  inflight.global = 0;
  inflight.tenants.clear();
}

export async function withConcurrencyLimit<T>(
  tenantId: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const globalLimit = getGlobalLimit();
  const tenantLimit = getTenantLimit(tenantId);
  const tenantInflight = tenantId ? inflight.tenants.get(tenantId) ?? 0 : 0;

  if (inflight.global >= globalLimit) {
    throw new ConcurrencyLimitError(
      `Global concurrency limit reached (${globalLimit})`,
      503,
      ErrorCodes.concurrencyGlobalLimitReached,
    );
  }

  if (tenantId && tenantLimit !== undefined && tenantInflight >= tenantLimit) {
    throw new ConcurrencyLimitError(
      `Tenant concurrency limit reached (${tenantLimit})`,
      429,
      ErrorCodes.concurrencyTenantLimitReached,
    );
  }

  inflight.global += 1;
  if (tenantId) {
    inflight.tenants.set(tenantId, tenantInflight + 1);
  }

  try {
    return await operation();
  } finally {
    inflight.global -= 1;

    if (tenantId) {
      const nextCount = (inflight.tenants.get(tenantId) ?? 1) - 1;
      if (nextCount <= 0) {
        inflight.tenants.delete(tenantId);
      } else {
        inflight.tenants.set(tenantId, nextCount);
      }
    }
  }
}
