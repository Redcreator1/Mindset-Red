import { planFor, type Plan, type PlanId } from "./billing.js";

/**
 * Pure tenant helpers — no node:fs, safe to import from the Cloudflare Worker
 * runtime (which cannot resolve node:fs even with nodejs_compat).
 * The stateful pieces (TenantStore, UsageMeter, loadTenants) stay in tenants.ts.
 */

export interface Tenant {
  key: string;
  name: string;
  /** Repo names this key may access, or "*" for all. */
  repos: string[] | "*";
  /** Subscription plan id; defaults to "free". */
  plan?: PlanId;
  /** Explicit override of the plan's daily quota (optional). */
  dailyLimit?: number;
  /** GitHub App installation id, set when this tenant was created by an App install. */
  installationId?: number;
}

/** Resolve the effective daily quota for a tenant (override > plan). */
export function tenantDailyLimit(tenant: Tenant): number | null {
  if (tenant.dailyLimit !== undefined) return tenant.dailyLimit;
  return planFor(tenant.plan).dailyLimit;
}

export function tenantPlan(tenant: Tenant): Plan {
  return planFor(tenant.plan);
}

export function tenantMayAccess(tenant: Tenant, repo: string): boolean {
  return tenant.repos === "*" || tenant.repos.includes(repo);
}
