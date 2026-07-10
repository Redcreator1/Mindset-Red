import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { renderDashboard, summarizeRecords, summarizeTenant, type DashboardData } from "../dashboard.js";
import { createContextServer } from "../server.js";
import { TenantStore } from "../tenants.js";
import { indexCommits, writeMemory } from "../memory.js";
import type { MemoryRecord } from "../types.js";

const mk = (type: MemoryRecord["type"], id: string): MemoryRecord => ({
  type, id, title: `t${id}`, body: "", author: "dev", date: "2026-01-01", files: [],
});

test("summarizeRecords counts records by type", () => {
  const stat = summarizeRecords("repoA", [mk("commit", "1"), mk("commit", "2"), mk("pr", "3")]);
  assert.equal(stat.memoryRecords, 3);
  assert.deepEqual(stat.byType, { commit: 2, pr: 1 });
});

test("summarizeTenant reflects plan quota", () => {
  const stat = summarizeTenant({ key: "k", name: "alice", repos: ["a"], plan: "pro" }, 12);
  assert.equal(stat.plan, "pro");
  assert.equal(stat.dailyLimit, 5000);
  assert.equal(stat.requests, 12);
});

test("renderDashboard produces self-contained HTML and escapes input", () => {
  const data: DashboardData = {
    service: "mindset-ctx",
    repos: [{ name: "web", memoryRecords: 3, byType: { commit: 3 } }],
    tenants: [{ name: "<b>evil</b>", plan: "team", dailyLimit: 50000, requests: 10, repos: "*" }],
  };
  const html = renderDashboard(data);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(!/https?:\/\/(?!localhost)/.test(html.replace(/claude\S*/g, "")), "no external asset URLs");
  assert.ok(html.includes("&lt;b&gt;evil&lt;/b&gt;"), "tenant name is HTML-escaped");
  assert.ok(html.includes("mindset-ctx"));
  assert.ok(html.includes("50000") || html.includes("50,000") === false); // quota shown
});

function makeRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ctx-${name}-`));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t.t" };
  execFileSync("git", ["-C", dir, "init", "-q"], { env });
  execFileSync("git", ["-C", dir, "add", "."], { env });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", `feat: ${name}`], { env });
  writeMemory(dir, indexCommits(dir));
  return dir;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, r));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test("dashboard routes serve HTML and JSON, scoped per tenant", async () => {
  const alpha = makeRepo("alpha");
  const beta = makeRepo("beta");
  const store = new TenantStore([
    { key: "sk-alice", name: "alice", repos: ["alpha"], plan: "pro" },
    { key: "sk-admin", name: "admin", repos: "*", plan: "enterprise" },
  ]);
  const server = createContextServer({ alpha, beta }, { tenantStore: store });
  const base = await listen(server);

  try {
    // Alice sees only alpha and only herself.
    const aliceData = await (await fetch(`${base}/v1/dashboard/data`, { headers: { authorization: "Bearer sk-alice" } })).json() as DashboardData;
    assert.deepEqual(aliceData.repos.map((r) => r.name), ["alpha"]);
    assert.deepEqual(aliceData.tenants.map((t) => t.name), ["alice"]);

    // Admin sees both repos and all tenants.
    const adminData = await (await fetch(`${base}/v1/dashboard/data`, { headers: { authorization: "Bearer sk-admin" } })).json() as DashboardData;
    assert.deepEqual(adminData.repos.map((r) => r.name).sort(), ["alpha", "beta"]);
    assert.equal(adminData.tenants.length, 2);

    // HTML shell renders and carries the data.
    const htmlRes = await fetch(`${base}/v1/dashboard`, { headers: { authorization: "Bearer sk-admin" } });
    assert.equal(htmlRes.headers.get("content-type"), "text/html; charset=utf-8");
    const html = await htmlRes.text();
    assert.ok(html.includes("<!doctype html>"));
    assert.ok(html.includes("alpha") && html.includes("beta"));

    // Unauthenticated → 401 in tenants mode.
    assert.equal((await fetch(`${base}/v1/dashboard`)).status, 401);
  } finally {
    server.close();
  }
});

test("hybrid search mode is reachable over HTTP", async () => {
  const repo = makeRepo("searchable");
  const server = createContextServer({ searchable: repo });
  const base = await listen(server);
  try {
    // No embeddings indexed → hybrid degrades to lexical, still 200.
    const res = await fetch(`${base}/v1/repos/searchable/memory/search?q=searchable&mode=hybrid`);
    assert.equal(res.status, 200);
    const body = await res.json() as { mode: string; results: unknown[] };
    assert.equal(body.mode, "hybrid");
    assert.ok(Array.isArray(body.results));
  } finally {
    server.close();
  }
});
