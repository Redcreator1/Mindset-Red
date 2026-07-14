import { PLANS, type PlanId } from "../billing.js";
import { orgDailyLimit, tenantDailyLimit, type Organization, type Tenant } from "../tenant-core.js";
export { orgDailyLimit, orgPlan, tenantCanManageBilling, tenantDailyLimit, tenantMayAccess, tenantPlan, type Organization, type Tenant } from "../tenant-core.js";

/**
 * KV-backed tenant + organization + usage stores for the Cloudflare Workers
 * runtime. Shares the Tenant/Organization shape from tenant-core.ts (rather
 * than a parallel WorkerTenant type) so this and the Node store (tenants.ts)
 * can never silently drift apart.
 * Keys:
 *   tenant:<key>            → JSON of the Tenant
 *   org:<id>                → JSON of the Organization
 *   usage:<key-or-org>:<YYYY-MM-DD> → integer request count (48h TTL)
 */

// Minimal duck type for the KV binding — matches Cloudflare's KVNamespace.
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string }): Promise<{ keys: { name: string }[] }>;
}

const USAGE_TTL = 60 * 60 * 48; // 48h — covers timezone edge cases

export class KvTenantStore {
  constructor(private readonly kv: KVLike) {}

  async get(key: string | undefined): Promise<Tenant | null> {
    if (!key) return null;
    const raw = await this.kv.get(`tenant:${key}`);
    return raw ? (JSON.parse(raw) as Tenant) : null;
  }

  async upsert(tenant: Tenant): Promise<void> {
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
  async list(): Promise<Tenant[]> {
    const { keys } = await this.kv.list({ prefix: "tenant:" });
    const results = await Promise.all(keys.map((k) => this.kv.get(k.name)));
    return results.filter((r): r is string => r !== null).map((r) => JSON.parse(r) as Tenant);
  }

  /** Remove a tenant (e.g. an owner removing a teammate). Returns whether it existed. */
  async remove(key: string): Promise<boolean> {
    const existing = await this.kv.get(`tenant:${key}`);
    if (existing === null) return false;
    await this.kv.delete(`tenant:${key}`);
    return true;
  }

  /** Find the tenant created by a given GitHub App installation, if any. */
  async findByInstallationId(installationId: number): Promise<Tenant | null> {
    const all = await this.list();
    return all.find((t) => t.installationId === installationId) ?? null;
  }

  async getOrg(id: string | undefined): Promise<Organization | null> {
    if (!id) return null;
    const raw = await this.kv.get(`org:${id}`);
    return raw ? (JSON.parse(raw) as Organization) : null;
  }

  async upsertOrg(org: Organization): Promise<void> {
    await this.kv.put(`org:${org.id}`, JSON.stringify(org));
  }

  async setOrgPlan(id: string, plan: PlanId): Promise<boolean> {
    const org = await this.getOrg(id);
    if (!org) return false;
    org.plan = plan;
    delete org.dailyLimit;
    await this.upsertOrg(org);
    return true;
  }

  /** Every tenant belonging to an organization — the owner's team roster. */
  async membersOf(orgId: string): Promise<Tenant[]> {
    const all = await this.list();
    return all.filter((t) => t.orgId === orgId);
  }
}

/**
 * KV-backed daily usage metering. When `org` is passed, every teammate
 * meters against the same pooled counter (keyed by org id) and the org's
 * plan/quota governs — a team shares one quota, it isn't multiplied per seat.
 */
export class KvUsageMeter {
  constructor(private readonly kv: KVLike) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Count one request; returns false if over quota. */
  async consume(tenant: Tenant, org?: Organization | null): Promise<boolean> {
    const limit = org ? orgDailyLimit(org) : tenantDailyLimit(tenant);
    const meterKey = org ? `org:${org.id}` : tenant.key;
    const key = `usage:${meterKey}:${this.today()}`;
    const current = Number((await this.kv.get(key)) ?? 0);
    if (limit !== null && current >= limit) return false;
    await this.kv.put(key, String(current + 1), { expirationTtl: USAGE_TTL });
    return true;
  }

  async report(tenant: Tenant, org?: Organization | null): Promise<{
    name: string; plan: PlanId; date: string; requests: number; dailyLimit: number | null;
  }> {
    const meterKey = org ? `org:${org.id}` : tenant.key;
    const date = this.today();
    const raw = await this.kv.get(`usage:${meterKey}:${date}`);
    return {
      name: tenant.name,
      plan: (org ? org.plan : tenant.plan) ?? "free",
      date,
      requests: Number(raw ?? 0),
      dailyLimit: org ? orgDailyLimit(org) : tenantDailyLimit(tenant),
    };
  }
}

export function newTenantKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "sk-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Mint a fresh, unguessable organization id (for Team-plan multi-seat signup). */
export function newOrgId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "org-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Validate that a plan id is a known one. */
export function isValidPlan(plan: string): plan is PlanId {
  return plan in PLANS;
}
