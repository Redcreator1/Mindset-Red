import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import {
  PLANS, planFor, planForPrice, loadPriceMap,
  verifyStripeSignature, resolveSubscriptionEvent,
} from "../billing.js";
import { TenantStore, tenantDailyLimit, parseTenants } from "../tenants.js";
import { buildAppManifest, classifyAppEvent } from "../githubapp.js";
import { createContextServer } from "../server.js";
import { indexCommits, writeMemory } from "../memory.js";

// ---------- billing plans ----------

test("plans map to quotas and planFor defaults to free", () => {
  assert.equal(planFor("pro").dailyLimit, 5000);
  assert.equal(planFor(undefined).id, "free");
  assert.equal(planFor("bogus").id, "free");
  assert.equal(PLANS.enterprise.dailyLimit, null, "enterprise is unlimited");
});

test("planForPrice resolves via the price map, unknowns → free", () => {
  const map = { price_pro: "pro" as const, price_team: "team" as const };
  assert.equal(planForPrice("price_pro", map), "pro");
  assert.equal(planForPrice("price_unknown", map), "free");
  assert.equal(planForPrice(undefined, map), "free");
});

test("loadPriceMap validates plan ids", () => {
  assert.deepEqual(loadPriceMap('{"price_1":"pro"}'), { price_1: "pro" });
  assert.deepEqual(loadPriceMap(undefined), {});
  assert.throws(() => loadPriceMap('{"price_1":"platinum"}'), /unknown plan/);
});

test("tenantDailyLimit: override beats plan, plan beats default", () => {
  assert.equal(tenantDailyLimit({ key: "k", name: "n", repos: "*", plan: "pro" }), 5000);
  assert.equal(tenantDailyLimit({ key: "k", name: "n", repos: "*", plan: "pro", dailyLimit: 10 }), 10);
  assert.equal(tenantDailyLimit({ key: "k", name: "n", repos: "*" }), PLANS.free.dailyLimit);
  assert.equal(tenantDailyLimit({ key: "k", name: "n", repos: "*", plan: "enterprise" }), null);
});

// ---------- Stripe signature ----------

test("verifyStripeSignature accepts a fresh valid signature, rejects tampering/replay", () => {
  const secret = "whsec_test";
  const payload = '{"hello":"world"}';
  const now = 1_800_000_000;
  const sig = createHmac("sha256", secret).update(`${now}.${payload}`).digest("hex");
  const header = `t=${now},v1=${sig}`;

  assert.equal(verifyStripeSignature(payload, header, secret, 300, now), true);
  assert.equal(verifyStripeSignature(payload, header, secret, 300, now + 10), true, "within tolerance");
  assert.equal(verifyStripeSignature(payload, header, secret, 300, now + 999), false, "replay past tolerance");
  assert.equal(verifyStripeSignature('{"hello":"tampered"}', header, secret, 300, now), false, "payload tampered");
  assert.equal(verifyStripeSignature(payload, header, "wrong", 300, now), false, "wrong secret");
  assert.equal(verifyStripeSignature(payload, undefined, secret, 300, now), false, "no header");
});

// ---------- Stripe event → plan change ----------

test("resolveSubscriptionEvent maps subscription lifecycle to plan changes", () => {
  const priceMap = { price_pro: "pro" as const };
  const mkEvent = (type: string, status: string) => ({
    type,
    data: {
      object: {
        id: "sub_1", status,
        metadata: { tenant_key: "sk-alice" },
        items: { data: [{ price: { id: "price_pro" } }] },
      },
    },
  });

  assert.deepEqual(resolveSubscriptionEvent(mkEvent("customer.subscription.created", "active"), priceMap), {
    action: "set-plan", tenantKey: "sk-alice", plan: "pro",
  });
  assert.deepEqual(resolveSubscriptionEvent(mkEvent("customer.subscription.updated", "past_due"), priceMap), {
    action: "downgrade", tenantKey: "sk-alice", plan: "free",
  });
  assert.deepEqual(resolveSubscriptionEvent(mkEvent("customer.subscription.deleted", "canceled"), priceMap), {
    action: "downgrade", tenantKey: "sk-alice", plan: "free",
  });
  assert.equal(resolveSubscriptionEvent(mkEvent("invoice.paid", "active"), priceMap).action, "ignored");

  const noKey = { type: "customer.subscription.created", data: { object: { id: "s", status: "active" } } };
  assert.match((resolveSubscriptionEvent(noKey, priceMap) as { reason: string }).reason, /tenant_key/);
});

// ---------- TenantStore persistence ----------

test("TenantStore.setPlan mutates and persists to file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctx-store-"));
  const path = join(dir, "ctx.tenants.json");
  writeFileSync(path, JSON.stringify({ tenants: [{ key: "sk-alice", name: "alice", repos: "*", plan: "free" }] }));

  const store = TenantStore.fromFile(path);
  assert.equal(store.get("sk-alice")?.plan, "free");
  assert.equal(store.setPlan("sk-alice", "pro"), true);
  assert.equal(store.get("sk-alice")?.plan, "pro");
  assert.equal(store.setPlan("sk-nobody", "pro"), false);

  // Persisted: a fresh load sees the upgrade.
  assert.equal(parseTenants(readFileSync(path, "utf8"))[0].plan, "pro");
});

// ---------- GitHub App ----------

test("buildAppManifest points webhooks at the base URL with least-privilege perms", () => {
  const m = buildAppManifest("https://ctx.example.com/");
  assert.equal(m.hook_attributes.url, "https://ctx.example.com/v1/app/webhook");
  assert.equal(m.redirect_url, "https://ctx.example.com/v1/app/installed");
  assert.equal(m.default_permissions.contents, "read");
  assert.ok(!("write" in Object.values(m.default_permissions)), "no write scopes");
  assert.ok(m.default_events.includes("installation"));
});

test("classifyAppEvent maps installation lifecycle events", () => {
  const inst = { installation: { id: 42, account: { login: "acme" } } };
  assert.deepEqual(classifyAppEvent("installation", { ...inst, action: "created", repositories: [{ full_name: "acme/web" }] }), {
    kind: "installed", installationId: 42, account: "acme", repos: ["acme/web"],
  });
  assert.deepEqual(classifyAppEvent("installation", { ...inst, action: "deleted" }), {
    kind: "uninstalled", installationId: 42, account: "acme",
  });
  assert.deepEqual(classifyAppEvent("installation_repositories", { ...inst, repositories_added: [{ full_name: "acme/api" }] }), {
    kind: "repos-added", installationId: 42, account: "acme", repos: ["acme/api"],
  });
  assert.equal(classifyAppEvent("installation", { action: "created" }).kind, "ignored", "no installation id");
});

// ---------- end-to-end over HTTP ----------

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

test("Stripe webhook upgrades a tenant's plan end-to-end", async () => {
  const repo = makeRepo("billed");
  const store = new TenantStore([{ key: "sk-alice", name: "alice", repos: "*", plan: "free" }]);
  const stripeSecret = "whsec_e2e";
  const server = createContextServer({ billed: repo }, {
    tenantStore: store,
    stripeSecret,
    stripePriceMap: { price_pro: "pro" },
  });
  const base = await listen(server);

  const event = JSON.stringify({
    type: "customer.subscription.created",
    data: { object: { id: "sub_1", status: "active", metadata: { tenant_key: "sk-alice" }, items: { data: [{ price: { id: "price_pro" } }] } } },
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", stripeSecret).update(`${ts}.${event}`).digest("hex");

  try {
    // Before: alice is on free (200/day).
    const before = await (await fetch(`${base}/v1/usage`, { headers: { authorization: "Bearer sk-alice" } })).json() as { plan: string; dailyLimit: number };
    assert.equal(before.plan, "free");
    assert.equal(before.dailyLimit, 200);

    // Bad signature → 400, no change.
    const bad = await fetch(`${base}/v1/stripe/webhook`, {
      method: "POST", headers: { "stripe-signature": `t=${ts},v1=deadbeef` }, body: event,
    });
    assert.equal(bad.status, 400);

    // Valid signature → plan upgraded.
    const ok = await fetch(`${base}/v1/stripe/webhook`, {
      method: "POST", headers: { "stripe-signature": `t=${ts},v1=${sig}` }, body: event,
    });
    assert.equal(ok.status, 200);
    const result = await ok.json() as { action: string; plan: string; applied: boolean };
    assert.equal(result.action, "set-plan");
    assert.equal(result.applied, true);
    assert.equal(store.get("sk-alice")?.plan, "pro");

    // After: alice is on pro (5000/day).
    const after = await (await fetch(`${base}/v1/usage`, { headers: { authorization: "Bearer sk-alice" } })).json() as { plan: string; dailyLimit: number };
    assert.equal(after.plan, "pro");
    assert.equal(after.dailyLimit, 5000);
  } finally {
    server.close();
  }
});

test("App manifest served and App webhook classifies installs", async () => {
  const repo = makeRepo("appd");
  const server = createContextServer({ appd: repo }, { webhookSecret: "wh", appBaseUrl: "https://ctx.example.com" });
  const base = await listen(server);
  const payload = JSON.stringify({ action: "created", installation: { id: 7, account: { login: "acme" } }, repositories: [{ full_name: "acme/web" }] });
  const sign = (b: string) => "sha256=" + createHmac("sha256", "wh").update(b).digest("hex");

  try {
    const manifest = await (await fetch(`${base}/v1/app/manifest`)).json() as { hook_attributes: { url: string } };
    assert.equal(manifest.hook_attributes.url, "https://ctx.example.com/v1/app/webhook");

    const bad = await fetch(`${base}/v1/app/webhook`, {
      method: "POST", headers: { "x-github-event": "installation", "x-hub-signature-256": sign("other") }, body: payload,
    });
    assert.equal(bad.status, 401);

    const ok = await fetch(`${base}/v1/app/webhook`, {
      method: "POST", headers: { "x-github-event": "installation", "x-hub-signature-256": sign(payload) }, body: payload,
    });
    assert.equal(ok.status, 200);
    const result = await ok.json() as { outcome: { kind: string; account: string } };
    assert.equal(result.outcome.kind, "installed");
    assert.equal(result.outcome.account, "acme");
  } finally {
    server.close();
  }
});
