import { planFor, type Plan, type PlanId } from "./billing.js";

/**
 * Pure tenant + organization helpers — no node:fs, safe to import from the
 * Cloudflare Worker runtime (which cannot resolve node:fs even with
 * nodejs_compat). The stateful pieces (TenantStore, UsageMeter, loadTenants)
 * stay in tenants.ts.
 */

export interface Tenant {
  key: string;
  name: string;
  /** Repo names this key may access, or "*" for all. */
  repos: string[] | "*";
  /** Subscription plan id; defaults to "free". Ignored when orgId is set — the org's plan governs. */
  plan?: PlanId;
  /** Explicit override of the plan's daily quota (optional). Ignored when orgId is set. */
  dailyLimit?: number;
  /** GitHub App installation id, set when this tenant was created by an App install. */
  installationId?: number;
  /**
   * Dashboard operator: sees every tenant instead of just itself. Must be set
   * explicitly (hand-edit the store) — NEVER inferred from repo scope, since
   * self-service signup and App installs both legitimately produce "*"-scoped
   * customer tenants.
   */
  admin?: boolean;
  /** Organization this tenant belongs to, if it's a team seat rather than a solo account. */
  orgId?: string;
  /** Role within orgId. Meaningless without orgId. Only "owner" can manage billing/invites. */
  role?: "owner" | "member";
  /** WorkOS user id, set when this tenant was provisioned by an SSO login rather than signup/App install. */
  ssoUserId?: string;
}

/**
 * A multi-seat team: billing and quota live here, not on individual member
 * tenants, so every member of the org shares one plan and one daily pool.
 */
export interface Organization {
  id: string;
  name: string;
  plan?: PlanId;
  dailyLimit?: number;
  /** Repo names members may access, or "*" for all. */
  repos: string[] | "*";
  /** WorkOS organization id — links a WorkOS company to this org so every employee who logs in via SSO lands in the same pooled team, not a fresh one each time. */
  ssoOrgId?: string;
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

/** Resolve the effective daily quota for an organization (override > plan). */
export function orgDailyLimit(org: Organization): number | null {
  if (org.dailyLimit !== undefined) return org.dailyLimit;
  return planFor(org.plan).dailyLimit;
}

export function orgPlan(org: Organization): Plan {
  return planFor(org.plan);
}

/**
 * Whether this tenant may change billing (upgrade/downgrade the plan they're
 * on). Solo tenants always can — they're the only seat. Org members need the
 * owner role, since a plan change affects every teammate's shared quota.
 */
export function tenantCanManageBilling(tenant: Tenant): boolean {
  return !tenant.orgId || tenant.role === "owner";
}
