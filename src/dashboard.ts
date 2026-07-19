import type { Tenant } from "./tenant-core.js";
import { tenantDailyLimit, tenantPlan } from "./tenant-core.js";
import type { MemoryRecord } from "./types.js";
import { SUPPORT_EMAIL } from "./home.js";

/**
 * Web dashboard for the hosted mode: a single self-contained HTML page
 * (no external assets, no build step) that visualizes repos, tenants,
 * plans/quotas and the memory layer. Data is fetched from a companion JSON
 * endpoint so the same server serves both the shell and the numbers.
 */

export interface RepoStat {
  name: string;
  memoryRecords: number;
  byType: Record<string, number>;
}

export interface TenantStat {
  name: string;
  plan: string;
  dailyLimit: number | null;
  requests: number;
  repos: string[] | "*";
}

export interface DashboardData {
  service: string;
  repos: RepoStat[];
  tenants: TenantStat[];
}

/** Aggregate memory records by type for a repo stat. */
export function summarizeRecords(name: string, records: MemoryRecord[]): RepoStat {
  const byType: Record<string, number> = {};
  for (const r of records) byType[r.type] = (byType[r.type] ?? 0) + 1;
  return { name, memoryRecords: records.length, byType };
}

export function summarizeTenant(tenant: Tenant, requests: number): TenantStat {
  return {
    name: tenant.name,
    plan: tenantPlan(tenant).id,
    dailyLimit: tenantDailyLimit(tenant),
    requests,
    repos: tenant.repos,
  };
}

const PLAN_COLORS: Record<string, string> = {
  free: "#64748b",
  pro: "#2563eb",
  team: "#7c3aed",
  enterprise: "#059669",
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Render the dashboard as a self-contained HTML string. */
export function renderDashboard(data: DashboardData): string {
  const repoRows = data.repos
    .map((r) => {
      const types = Object.entries(r.byType)
        .map(([t, n]) => `<span class="chip">${esc(t)} ${n}</span>`)
        .join(" ");
      return `<tr><td><strong>${esc(r.name)}</strong></td><td>${r.memoryRecords}</td><td>${types || "—"}</td></tr>`;
    })
    .join("\n");

  const tenantRows = data.tenants
    .map((t) => {
      const limit = t.dailyLimit === null ? "∞" : String(t.dailyLimit);
      const pct = t.dailyLimit === null ? 0 : Math.min(100, Math.round((t.requests / t.dailyLimit) * 100));
      const scope = t.repos === "*" ? "all repos" : (t.repos as string[]).join(", ");
      const color = PLAN_COLORS[t.plan] ?? "#64748b";
      return `<tr>
        <td><strong>${esc(t.name)}</strong></td>
        <td><span class="plan" style="background:${color}">${esc(t.plan)}</span></td>
        <td>${esc(scope)}</td>
        <td>${t.requests} / ${limit}</td>
        <td><div class="bar"><div class="fill" style="width:${pct}%;background:${color}"></div></div></td>
      </tr>`;
    })
    .join("\n");

  const totalRecords = data.repos.reduce((s, r) => s + r.memoryRecords, 0);

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.service)} — dashboard</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #0b1220; color: #e2e8f0; }
  header { padding: 24px 32px; border-bottom: 1px solid #1e293b; display: flex; align-items: baseline; gap: 16px; }
  h1 { margin: 0; font-size: 20px; }
  .tag { color: #64748b; font-size: 13px; }
  main { padding: 24px 32px; max-width: 1000px; margin: 0 auto; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card { background: #111a2e; border: 1px solid #1e293b; border-radius: 10px; padding: 16px 20px; }
  .card .n { font-size: 28px; font-weight: 700; }
  .card .l { color: #94a3b8; font-size: 13px; margin-top: 4px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; margin: 28px 0 12px; }
  table { width: 100%; border-collapse: collapse; background: #111a2e; border: 1px solid #1e293b; border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 16px; border-bottom: 1px solid #1e293b; }
  th { color: #94a3b8; font-weight: 600; font-size: 13px; }
  tr:last-child td { border-bottom: none; }
  .chip { background: #1e293b; border-radius: 6px; padding: 2px 8px; font-size: 12px; margin-right: 4px; white-space: nowrap; }
  .plan { color: #fff; border-radius: 6px; padding: 2px 10px; font-size: 12px; font-weight: 600; text-transform: capitalize; }
  .bar { background: #1e293b; border-radius: 5px; height: 8px; width: 120px; overflow: hidden; }
  .fill { height: 100%; border-radius: 5px; transition: width .3s; }
  .empty { color: #64748b; font-style: italic; }
  footer { padding: 24px 32px; color: #475569; font-size: 12px; text-align: center; }
</style></head>
<body>
<header><h1>${esc(data.service)}</h1><span class="tag">Context-as-a-Service · dashboard</span></header>
<main>
  <div class="cards">
    <div class="card"><div class="n">${data.repos.length}</div><div class="l">repositories</div></div>
    <div class="card"><div class="n">${totalRecords}</div><div class="l">memory records</div></div>
    <div class="card"><div class="n">${data.tenants.length}</div><div class="l">tenants</div></div>
  </div>

  <h2>Repositories</h2>
  <table><thead><tr><th>Repo</th><th>Records</th><th>Breakdown</th></tr></thead>
  <tbody>${repoRows || '<tr><td colspan="3" class="empty">No repos.</td></tr>'}</tbody></table>

  <h2>Tenants &amp; plans</h2>
  ${
    data.tenants.length
      ? `<table><thead><tr><th>Tenant</th><th>Plan</th><th>Scope</th><th>Today</th><th>Quota</th></tr></thead>
         <tbody>${tenantRows}</tbody></table>`
      : '<p class="empty">Running without tenants (single shared key or open access).</p>'
  }
</main>
<footer>mindset-ctx · <a href="/v1/dashboard/data" style="color:#475569">JSON</a> · auto-generated · <a href="mailto:${SUPPORT_EMAIL}" style="color:#475569">Support</a></footer>
</body></html>`;
}
