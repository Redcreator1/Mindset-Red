import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PLANS, type PlanId } from "./billing.js";
import { orgDailyLimit, tenantDailyLimit, type Organization, type Tenant } from "./tenant-core.js";
export {
  orgDailyLimit, orgPlan, tenantCanManageBilling, tenantDailyLimit, tenantMayAccess, tenantPlan,
  type Organization, type Tenant,
} from "./tenant-core.js";

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

// Tenant, tenantDailyLimit, tenantPlan, tenantMayAccess are re-exported from
// ./tenant-core.js above so that dashboard.ts (and the Cloudflare Worker) can
// import them without pulling in node:fs.

export function parseTenants(json: string): Tenant[] {
  return parseTeamFile(json).tenants;
}

interface TeamFile {
  tenants: Tenant[];
  organizations: Organization[];
}

function parseTeamFile(json: string): TeamFile {
  const parsed = JSON.parse(json) as { tenants?: Tenant[]; organizations?: Organization[] };
  const tenants = parsed.tenants ?? [];
  for (const t of tenants) {
    if (!t.key || !t.name) throw new Error(`Tenant entries need "key" and "name" (offender: ${JSON.stringify(t)})`);
    if (t.plan && !PLANS[t.plan]) throw new Error(`Tenant '${t.name}' has unknown plan '${t.plan}'`);
  }
  const organizations = parsed.organizations ?? [];
  for (const o of organizations) {
    if (!o.id || !o.name) throw new Error(`Organization entries need "id" and "name" (offender: ${JSON.stringify(o)})`);
    if (o.plan && !PLANS[o.plan]) throw new Error(`Organization '${o.name}' has unknown plan '${o.plan}'`);
  }
  return { tenants, organizations };
}

export function loadTenants(path: string): Tenant[] {
  return parseTenants(readFileSync(path, "utf8"));
}

/**
 * A mutable, optionally file-backed store of tenants **and** the
 * organizations (teams) some of them belong to. Kept in one store because
 * they're always used together: resolving a request's effective plan/quota
 * means looking up the tenant, then — if it has an orgId — its organization.
 * Stripe webhooks call setPlan()/setOrgPlan() to change billing; when
 * constructed with a path, changes are persisted so they survive a restart.
 */
export class TenantStore {
  private byKey = new Map<string, Tenant>();
  private orgsById = new Map<string, Organization>();

  constructor(tenants: Tenant[], private readonly path?: string, organizations: Organization[] = []) {
    for (const t of tenants) this.byKey.set(t.key, t);
    for (const o of organizations) this.orgsById.set(o.id, o);
  }

  static fromFile(path: string): TenantStore {
    const { tenants, organizations } = parseTeamFile(readFileSync(path, "utf8"));
    return new TenantStore(tenants, path, organizations);
  }

  all(): Tenant[] {
    return [...this.byKey.values()];
  }

  get(key: string | undefined): Tenant | null {
    return key ? this.byKey.get(key) ?? null : null;
  }

  /** Find the tenant created by a given GitHub App installation, if any. */
  findByInstallationId(installationId: number): Tenant | null {
    for (const t of this.byKey.values()) {
      if (t.installationId === installationId) return t;
    }
    return null;
  }

  /** Find the tenant provisioned by a given WorkOS SSO user, if any. */
  findBySsoUserId(ssoUserId: string): Tenant | null {
    for (const t of this.byKey.values()) {
      if (t.ssoUserId === ssoUserId) return t;
    }
    return null;
  }

  /** Find the organization linked to a given WorkOS company, if any. */
  findOrgBySsoOrgId(ssoOrgId: string): Organization | null {
    for (const o of this.orgsById.values()) {
      if (o.ssoOrgId === ssoOrgId) return o;
    }
    return null;
  }

  /** Remove a tenant by key; persists if file-backed. Returns whether it existed. */
  remove(key: string): boolean {
    const existed = this.byKey.delete(key);
    if (existed) this.persist();
    return existed;
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

  /** Add or replace a tenant; persists if file-backed. */
  upsert(tenant: Tenant): void {
    this.byKey.set(tenant.key, tenant);
    this.persist();
  }

  allOrganizations(): Organization[] {
    return [...this.orgsById.values()];
  }

  getOrg(id: string | undefined): Organization | null {
    return id ? this.orgsById.get(id) ?? null : null;
  }

  /** Add or replace an organization; persists if file-backed. */
  upsertOrg(org: Organization): void {
    this.orgsById.set(org.id, org);
    this.persist();
  }

  /** Change an organization's plan (from a Stripe event); persists if file-backed. */
  setOrgPlan(id: string, plan: PlanId): boolean {
    const org = this.orgsById.get(id);
    if (!org) return false;
    org.plan = plan;
    delete org.dailyLimit;
    this.persist();
    return true;
  }

  /** Every tenant belonging to an organization — the owner's team roster. */
  membersOf(orgId: string): Tenant[] {
    return this.all().filter((t) => t.orgId === orgId);
  }

  private persist(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      JSON.stringify({ tenants: this.all(), organizations: this.allOrganizations() }, null, 2) + "\n",
    );
  }
}

export interface UsageEntry {
  date: string;
  count: number;
}

/**
 * In-memory daily usage metering. When `org` is passed, every teammate meters
 * against the same pooled counter (keyed by org id) and the org's plan/quota
 * governs instead of the individual tenant's — a team shares one quota, it
 * isn't multiplied per seat.
 */
export class UsageMeter {
  private usage = new Map<string, UsageEntry>();

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Count one request; returns false when over the tenant's (or org's) quota. */
  consume(tenant: Tenant, org?: Organization | null): boolean {
    const limit = org ? orgDailyLimit(org) : tenantDailyLimit(tenant);
    const meterKey = org ? `org:${org.id}` : tenant.key;
    const date = this.today();
    const entry = this.usage.get(meterKey);
    const count = entry?.date === date ? entry.count : 0;
    if (limit !== null && count >= limit) return false;
    this.usage.set(meterKey, { date, count: count + 1 });
    return true;
  }

  report(tenant: Tenant, org?: Organization | null): {
    name: string;
    plan: PlanId;
    date: string;
    requests: number;
    dailyLimit: number | null;
  } {
    const meterKey = org ? `org:${org.id}` : tenant.key;
    const date = this.today();
    const entry = this.usage.get(meterKey);
    return {
      name: tenant.name,
      plan: (org ? org.plan : tenant.plan) ?? "free",
      date,
      requests: entry?.date === date ? entry.count : 0,
      dailyLimit: org ? orgDailyLimit(org) : tenantDailyLimit(tenant),
    };
  }
}

export function tenantForKey(tenants: Tenant[], key: string | undefined): Tenant | null {
  if (!key) return null;
  return tenants.find((t) => t.key === key) ?? null;
}

// tenantMayAccess is re-exported at the top of the file from tenant-core.js.
