import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createContextServer } from "../server.js";
import { indexCommits, writeMemory } from "../memory.js";
import { loadTenants, UsageMeter, type Tenant } from "../tenants.js";

function makeRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ctx-${name}-`));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t.t" };
  execFileSync("git", ["-C", dir, "init", "-q"], { env });
  execFileSync("git", ["-C", dir, "add", "."], { env });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", `feat: bootstrap ${name}`], { env });
  writeMemory(dir, indexCommits(dir));
  return dir;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, r));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test("GitHub webhook verifies HMAC and refreshes memory + context", async () => {
  const repo = makeRepo("hooked");
  rmSync(join(repo, ".context"), { recursive: true, force: true });
  const secret = "wh-secret";
  const server = createContextServer({ hooked: repo }, { webhookSecret: secret });
  const base = await listen(server);
  const payload = JSON.stringify({ ref: "refs/heads/main" });
  const sign = (body: string, s: string) => "sha256=" + createHmac("sha256", s).update(body).digest("hex");

  try {
    // Bad signature → 401, nothing happens.
    const bad = await fetch(`${base}/v1/repos/hooked/webhook`, {
      method: "POST",
      headers: { "x-github-event": "push", "x-hub-signature-256": sign(payload, "wrong-secret") },
      body: payload,
    });
    assert.equal(bad.status, 401);
    assert.ok(!existsSync(join(repo, "CLAUDE.md")));

    // Missing signature → 401 too.
    const missing = await fetch(`${base}/v1/repos/hooked/webhook`, {
      method: "POST", headers: { "x-github-event": "push" }, body: payload,
    });
    assert.equal(missing.status, 401);

    // ping → pong, no refresh.
    const ping = await fetch(`${base}/v1/repos/hooked/webhook`, {
      method: "POST",
      headers: { "x-github-event": "ping", "x-hub-signature-256": sign(payload, secret) },
      body: payload,
    });
    assert.equal((await ping.json() as { action: string }).action, "pong");

    // Valid push → memory re-indexed and context regenerated.
    const ok = await fetch(`${base}/v1/repos/hooked/webhook`, {
      method: "POST",
      headers: { "x-github-event": "push", "x-hub-signature-256": sign(payload, secret) },
      body: payload,
    });
    assert.equal(ok.status, 200);
    const result = await ok.json() as { ok: boolean; memoryRecords: number; regenerated: string[] };
    assert.equal(result.ok, true);
    assert.equal(result.memoryRecords, 1);
    assert.ok(result.regenerated.includes("CLAUDE.md"));
    assert.ok(existsSync(join(repo, "CLAUDE.md")), "context files written on push");

    // Uninteresting event → acknowledged but ignored.
    const star = await fetch(`${base}/v1/repos/hooked/webhook`, {
      method: "POST",
      headers: { "x-github-event": "star", "x-hub-signature-256": sign(payload, secret) },
      body: payload,
    });
    assert.equal((await star.json() as { action: string }).action, "ignored");
  } finally {
    server.close();
  }
});

test("GitLab webhook verifies the shared token and refreshes memory + context", async () => {
  const repo = makeRepo("hooked-gl");
  rmSync(join(repo, ".context"), { recursive: true, force: true });
  const secret = "wh-secret-gl";
  const server = createContextServer({ "hooked-gl": repo }, { webhookSecret: secret });
  const base = await listen(server);
  const payload = JSON.stringify({ object_kind: "push", ref: "refs/heads/main" });

  try {
    // Wrong token → 401, nothing happens.
    const bad = await fetch(`${base}/v1/repos/hooked-gl/webhook`, {
      method: "POST",
      headers: { "x-gitlab-event": "Push Hook", "x-gitlab-token": "wrong-token" },
      body: payload,
    });
    assert.equal(bad.status, 401);
    assert.ok(!existsSync(join(repo, "CLAUDE.md")));

    // Valid push → memory re-indexed and context regenerated, same as GitHub.
    const ok = await fetch(`${base}/v1/repos/hooked-gl/webhook`, {
      method: "POST",
      headers: { "x-gitlab-event": "Push Hook", "x-gitlab-token": secret },
      body: payload,
    });
    assert.equal(ok.status, 200);
    const result = await ok.json() as { ok: boolean; event: string; memoryRecords: number; regenerated: string[] };
    assert.equal(result.event, "push", "GitLab's 'Push Hook' is normalized to 'push'");
    assert.ok(result.regenerated.includes("CLAUDE.md"));
    assert.ok(existsSync(join(repo, "CLAUDE.md")));

    // Unmapped GitLab event → acknowledged but ignored, not mistaken for GitHub.
    const note = await fetch(`${base}/v1/repos/hooked-gl/webhook`, {
      method: "POST",
      headers: { "x-gitlab-event": "Note Hook", "x-gitlab-token": secret },
      body: payload,
    });
    assert.equal((await note.json() as { action: string }).action, "ignored");
  } finally {
    server.close();
  }
});

test("tenants: scoped keys, quotas and usage metering", async () => {
  const alphaRepo = makeRepo("alpha");
  const betaRepo = makeRepo("beta");
  const tenants: Tenant[] = [
    { key: "sk-alice", name: "alice", repos: ["alpha"], dailyLimit: 3 },
    { key: "sk-admin", name: "admin", repos: "*", plan: "enterprise" }, // enterprise = unlimited
  ];
  const server = createContextServer({ alpha: alphaRepo, beta: betaRepo }, { tenants });
  const base = await listen(server);
  const asAlice = { headers: { authorization: "Bearer sk-alice" } };

  try {
    assert.equal((await fetch(`${base}/v1/repos`)).status, 401, "no key → 401");
    assert.equal((await fetch(`${base}/v1/repos`, { headers: { "x-api-key": "sk-unknown" } })).status, 401);

    // Alice sees only her repo and cannot touch beta.
    const repos = await (await fetch(`${base}/v1/repos`, asAlice)).json() as { repos: { name: string }[] };
    assert.deepEqual(repos.repos.map((r) => r.name), ["alpha"]);
    assert.equal((await fetch(`${base}/v1/repos/beta/analysis`, asAlice)).status, 403);

    // Request #3 hits the quota; #4 is rejected with 429.
    const usage = await (await fetch(`${base}/v1/usage`, asAlice)).json() as { requests: number; dailyLimit: number };
    assert.equal(usage.dailyLimit, 3);
    assert.equal(usage.requests, 3);
    assert.equal((await fetch(`${base}/v1/repos/alpha/analysis`, asAlice)).status, 429);

    // Admin has wildcard scope and no quota.
    const admin = { headers: { authorization: "Bearer sk-admin" } };
    assert.equal((await fetch(`${base}/v1/repos/beta/analysis`, admin)).status, 200);
    const adminUsage = await (await fetch(`${base}/v1/usage`, admin)).json() as { dailyLimit: number | null };
    assert.equal(adminUsage.dailyLimit, null);

    // Health stays open even in tenants mode.
    assert.equal((await fetch(`${base}/v1/health`)).status, 200);
  } finally {
    server.close();
  }
});

test("loadTenants validates the config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctx-tenants-"));
  const good = join(dir, "ctx.tenants.json");
  writeFileSync(good, JSON.stringify({ tenants: [{ key: "k", name: "n", repos: "*" }] }));
  assert.equal(loadTenants(good).length, 1);

  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ tenants: [{ repos: "*" }] }));
  assert.throws(() => loadTenants(bad), /need "key" and "name"/);
});

test("UsageMeter counts per day and enforces limits", () => {
  const meter = new UsageMeter();
  const t: Tenant = { key: "k", name: "n", repos: "*", dailyLimit: 2 };
  assert.equal(meter.consume(t), true);
  assert.equal(meter.consume(t), true);
  assert.equal(meter.consume(t), false, "third request exceeds dailyLimit 2");
  assert.equal(meter.report(t).requests, 2);
});
