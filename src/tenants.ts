import { readFileSync } from "node:fs";

/**
 * Multi-tenant access control for the hosted mode: each tenant gets an API
 * key, a repo scope and an optional daily request quota. Configured via a
 * JSON file (ctx.tenants.json) passed to `ctx serve --tenants`.
 *
 *   { "tenants": [
 *       { "key": "sk-alice-...", "name": "alice", "repos": ["frontend"], "dailyLimit": 1000 },
 *       { "key": "sk-admin-...", "name": "admin", "repos": "*" }
 *   ] }
 */

export interface Tenant {
  key: string;
  name: string;
  /** Repo names this key may access, or "*" for all. */
  repos: string[] | "*";
  /** Max requests per UTC day; unlimited when omitted. */
  dailyLimit?: number;
}

export function loadTenants(path: string): Tenant[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { tenants?: Tenant[] };
  const tenants = parsed.tenants ?? [];
  for (const t of tenants) {
    if (!t.key || !t.name) throw new Error(`Tenant entries need "key" and "name" (offender: ${JSON.stringify(t)})`);
  }
  return tenants;
}

export interface UsageEntry {
  date: string;
  count: number;
}

/** In-memory per-key daily usage metering — the seed of billing. */
export class UsageMeter {
  private usage = new Map<string, UsageEntry>();

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Count one request; returns false when the tenant is over quota. */
  consume(tenant: Tenant): boolean {
    const date = this.today();
    const entry = this.usage.get(tenant.key);
    const count = entry?.date === date ? entry.count : 0;
    if (tenant.dailyLimit !== undefined && count >= tenant.dailyLimit) return false;
    this.usage.set(tenant.key, { date, count: count + 1 });
    return true;
  }

  report(tenant: Tenant): { name: string; date: string; requests: number; dailyLimit: number | null } {
    const date = this.today();
    const entry = this.usage.get(tenant.key);
    return {
      name: tenant.name,
      date,
      requests: entry?.date === date ? entry.count : 0,
      dailyLimit: tenant.dailyLimit ?? null,
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
