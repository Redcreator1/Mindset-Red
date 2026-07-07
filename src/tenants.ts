import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PLANS, planFor, type Plan, type PlanId } from "./billing.js";

/**
 * Multi-tenant access control for the hosted mode: each tenant gets an API
 * key, a repo scope and a subscription plan. Configured via a JSON file
 * (ctx.tenants.json) passed to `ctx serve --tenants`; the same file is
 * rewritten in place when a Stripe webhook changes a tenant's plan.
 *
 *   { "tenants": [
 *       { "key": "sk-alice-...", "name": "alice", "repos": ["frontend"], "plan": "pro" },
 *       { "key": "sk-admin-...", "name": "admin", "repos": "*", "plan": "enterprise" }
 *   ] }
 *
 * `plan` decides the daily quota (see billing.ts). A legacy `dailyLimit`
 * field still overrides the plan quota when present, for hand-tuned tenants.
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
}

/** Resolve the effective daily quota for a tenant (override > plan). */
export function tenantDailyLimit(tenant: Tenant): number | null {
  if (tenant.dailyLimit !== undefined) return tenant.dailyLimit;
  return planFor(tenant.plan).dailyLimit;
}

export function tenantPlan(tenant: Tenant): Plan {
  return planFor(tenant.plan);
}

export function parseTenants(json: string): Tenant[] {
  const parsed = JSON.parse(json) as { tenants?: Tenant[] };
  const tenants = parsed.tenants ?? [];
  for (const t of tenants) {
    if (!t.key || !t.name) throw new Error(`Tenant entries need "key" and "name" (offender: ${JSON.stringify(t)})`);
    if (t.plan && !PLANS[t.plan]) throw new Error(`Tenant '${t.name}' has unknown plan '${t.plan}'`);
  }
  return tenants;
}

export function loadTenants(path: string): Tenant[] {
  return parseTenants(readFileSync(path, "utf8"));
}

/**
 * A mutable, optionally file-backed store of tenants. Stripe webhooks call
 * setPlan() to change a tenant's plan; when constructed with a path, changes
 * are persisted so they survive a restart.
 */
export class TenantStore {
  private byKey = new Map<string, Tenant>();

  constructor(tenants: Tenant[], private readonly path?: string) {
    for (const t of tenants) this.byKey.set(t.key, t);
  }

  static fromFile(path: string): TenantStore {
    return new TenantStore(loadTenants(path), path);
  }

  all(): Tenant[] {
    return [...this.byKey.values()];
  }

  get(key: string | undefined): Tenant | null {
    return key ? this.byKey.get(key) ?? null : null;
  }

  /** Change a tenant's plan (from a Stripe event); persists if file-backed. */
  setPlan(key: string, plan: PlanId): boolean {
    const tenant = this.byKey.get(key);
    if (!tenant) return false;
    tenant.plan = plan;
    delete tenant.dailyLimit; // plan quota takes over from any manual override
    this.persist();
    return true;
  }

  private persist(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ tenants: this.all() }, null, 2) + "\n");
  }
}

export interface UsageEntry {
  date: string;
  count: number;
}

/** In-memory per-key daily usage metering. */
export class UsageMeter {
  private usage = new Map<string, UsageEntry>();

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Count one request; returns false when the tenant is over its plan quota. */
  consume(tenant: Tenant): boolean {
    const limit = tenantDailyLimit(tenant);
    const date = this.today();
    const entry = this.usage.get(tenant.key);
    const count = entry?.date === date ? entry.count : 0;
    if (limit !== null && count >= limit) return false;
    this.usage.set(tenant.key, { date, count: count + 1 });
    return true;
  }

  report(tenant: Tenant): {
    name: string;
    plan: PlanId;
    date: string;
    requests: number;
    dailyLimit: number | null;
  } {
    const date = this.today();
    const entry = this.usage.get(tenant.key);
    return {
      name: tenant.name,
      plan: tenant.plan ?? "free",
      date,
      requests: entry?.date === date ? entry.count : 0,
      dailyLimit: tenantDailyLimit(tenant),
    };
  }
}

export function tenantForKey(tenants: Tenant[], key: string | undefined): Tenant | null {
  if (!key) return null;
  return tenants.find((t) => t.key === key) ?? null;
}

export function tenantMayAccess(tenant: Tenant, repo: string): boolean {
  return tenant.repos === "*" || tenant.repos.includes(repo);
}
