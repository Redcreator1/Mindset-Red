import { planFor, PLANS, type PlanId } from "../billing.js";

/**
 * KV-backed tenant + usage stores for the Cloudflare Workers runtime.
 * Keys:
 *   tenant:<key>            → JSON of the Tenant
 *   usage:<key>:<YYYY-MM-DD> → integer request count (48h TTL)
 */

export interface WorkerTenant {
  key: string;
  name: string;
  repos: string[] | "*";
  plan?: PlanId;
  dailyLimit?: number;
  /**
   * Dashboard operator: sees every tenant instead of just itself. Must be
   * set explicitly (edit the tenant JSON in KV) — never inferred from repo
   * scope, since every self-service signup tenant is "*"-scoped.
   */
  admin?: boolean;
}

// Minimal duck type for the KV binding — matches Cloudflare's KVNamespace.
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string }): Promise<{ keys: { name: string }[] }>;
}

const USAGE_TTL = 60 * 60 * 48; // 48h — covers timezone edge cases

export function tenantDailyLimit(t: WorkerTenant): number | null {
  if (t.dailyLimit !== undefined) return t.dailyLimit;
  return planFor(t.plan).dailyLimit;
}

export class KvTenantStore {
  constructor(private readonly kv: KVLike) {}

  async get(key: string | undefined): Promise<WorkerTenant | null> {
    if (!key) return null;
    const raw = await this.kv.get(`tenant:${key}`);
    return raw ? (JSON.parse(raw) as WorkerTenant) : null;
  }

  async upsert(tenant: WorkerTenant): Promise<void> {
    await this.kv.put(`tenant:${tenant.key}`, JSON.stringify(tenant));
  }

  async setPlan(key: string, plan: PlanId): Promise<boolean> {
    const tenant = await this.get(key);
    if (!tenant) return false;
    tenant.plan = plan;
    delete tenant.dailyLimit;
    await this.upsert(tenant);
    return true;
  }

  /** Lists tenants — used by the dashboard admin view. */
  async list(): Promise<WorkerTenant[]> {
    const { keys } = await this.kv.list({ prefix: "tenant:" });
    const results = await Promise.all(keys.map((k) => this.kv.get(k.name)));
    return results.filter((r): r is string => r !== null).map((r) => JSON.parse(r) as WorkerTenant);
  }
}

export class KvUsageMeter {
  constructor(private readonly kv: KVLike) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Count one request; returns false if over quota. */
  async consume(tenant: WorkerTenant): Promise<boolean> {
    const limit = tenantDailyLimit(tenant);
    const key = `usage:${tenant.key}:${this.today()}`;
    const current = Number((await this.kv.get(key)) ?? 0);
    if (limit !== null && current >= limit) return false;
    await this.kv.put(key, String(current + 1), { expirationTtl: USAGE_TTL });
    return true;
  }

  async report(tenant: WorkerTenant): Promise<{
    name: string; plan: PlanId; date: string; requests: number; dailyLimit: number | null;
  }> {
    const date = this.today();
    const raw = await this.kv.get(`usage:${tenant.key}:${date}`);
    return {
      name: tenant.name,
      plan: tenant.plan ?? "free",
      date,
      requests: Number(raw ?? 0),
      dailyLimit: tenantDailyLimit(tenant),
    };
  }
}

export function newTenantKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "sk-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Validate that a plan id is a known one. */
export function isValidPlan(plan: string): plan is PlanId {
  return plan in PLANS;
}
