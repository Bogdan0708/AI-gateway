import { ErrorCodes } from "./error-codes";
import { TenantPolicyError } from "./tenant-policy";

interface TenantUsage {
  totalTokens: number;
  /** Calendar month key, e.g. "2026-03" */
  month: string;
}

const usageByTenant = new Map<string, TenantUsage>();

function currentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getOrCreateUsage(tenantId: string): TenantUsage {
  const month = currentMonth();
  const existing = usageByTenant.get(tenantId);

  if (existing && existing.month === month) {
    return existing;
  }

  // New month or first request — reset
  const usage: TenantUsage = { totalTokens: 0, month };
  usageByTenant.set(tenantId, usage);
  return usage;
}

/**
 * Check whether a tenant has exceeded their monthly token cap.
 * Throws TenantPolicyError if the cap is reached.
 */
export function enforceSpendCap(
  tenantId: string | undefined,
  maxMonthlyTokens: number | undefined,
): void {
  if (!tenantId || maxMonthlyTokens == null) {
    return;
  }

  const usage = getOrCreateUsage(tenantId);

  if (usage.totalTokens >= maxMonthlyTokens) {
    throw new TenantPolicyError(
      `Tenant ${tenantId} has reached its monthly token cap of ${maxMonthlyTokens} (used: ${usage.totalTokens})`,
      429,
      ErrorCodes.tenantSpendCapReached,
    );
  }
}

/**
 * Record token usage for a tenant after a successful request.
 */
export function recordTenantTokenUsage(
  tenantId: string | undefined,
  totalTokens: number,
): void {
  if (!tenantId || totalTokens <= 0) {
    return;
  }

  const usage = getOrCreateUsage(tenantId);
  usage.totalTokens += totalTokens;
}

/**
 * Get current monthly token usage for a tenant. Returns 0 if no usage recorded.
 */
export function getTenantTokenUsage(tenantId: string): number {
  const month = currentMonth();
  const usage = usageByTenant.get(tenantId);

  if (!usage || usage.month !== month) {
    return 0;
  }

  return usage.totalTokens;
}

/**
 * Reset all tracked usage. For testing only.
 */
export function resetSpendTracking(): void {
  usageByTenant.clear();
}
