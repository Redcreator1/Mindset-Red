import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { KvTenantStore, KvUsageMeter, newTenantKey, type KVLike } from "../worker/kv.js";
import { verifyStripeSignatureWeb } from "../worker/hmac.js";
import { createHmac } from "node:crypto";

/**
 * In-memory KV double for tests. Same behavior as Cloudflare KV, minus TTLs
 * (which we don't need to test the routing).
 */
class MemKV implements KVLike {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.store.get(key) ?? null; }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
  async list(opts?: { prefix?: string }): Promise<{ keys: { name: string }[] }> {
    const prefix = opts?.prefix ?? "";
    return { keys: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
  }
}

test("Worker: /v1/health returns ok", async () => {
  const env = { CTX_KV: new MemKV() };
  const res = await worker.fetch(new Request("https://ctx.example.com/v1/health"), env);
  assert.equal(res.status, 200);
  const body = await res.json() as { ok: boolean; edge: string };
  assert.equal(body.ok, true);
  assert.equal(body.edge, "cloudflare-workers");
});

test("Worker: /pricing renders the public HTML page", async () => {
  const env = { CTX_KV: new MemKV() };
  const res = await worker.fetch(new Request("https://ctx.example.com/pricing"), env);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.startsWith("<!doctype html>"));
  assert.match(body, /Passer Pro/);
});

test("Worker: unauthenticated dashboard call → 401", async () => {
  const env = { CTX_KV: new MemKV() };
  const res = await worker.fetch(new Request("https://ctx.example.com/v1/dashboard"), env);
  assert.equal(res.status, 401);
});

test("Worker: KvTenantStore round-trips and setPlan works", async () => {
  const kv = new MemKV();
  const store = new KvTenantStore(kv);
  await store.upsert({ key: "sk-alice", name: "alice", repos: "*", plan: "free" });
  const t1 = await store.get("sk-alice");
  assert.equal(t1?.plan, "free");
  assert.equal(await store.setPlan("sk-alice", "pro"), true);
  const t2 = await store.get("sk-alice");
  assert.equal(t2?.plan, "pro");
  assert.equal(await store.setPlan("sk-nobody", "pro"), false);
});

test("Worker: KvUsageMeter enforces quota", async () => {
  const kv = new MemKV();
  const store = new KvTenantStore(kv);
  const meter = new KvUsageMeter(kv);
  const tenant = { key: "sk-x", name: "x", repos: "*" as const, plan: "free" as const, dailyLimit: 2 };
  await store.upsert(tenant);
  assert.equal(await meter.consume(tenant), true);
  assert.equal(await meter.consume(tenant), true);
  assert.equal(await meter.consume(tenant), false, "third call exceeds override dailyLimit 2");
  assert.equal((await meter.report(tenant)).requests, 2);
});

test("Worker: end-to-end tenant auth + /v1/usage over KV", async () => {
  const kv = new MemKV();
  const store = new KvTenantStore(kv);
  await store.upsert({ key: "sk-alice", name: "alice", repos: "*", plan: "pro" });
  const env = { CTX_KV: kv };
  const res = await worker.fetch(
    new Request("https://ctx.example.com/v1/usage", { headers: { authorization: "Bearer sk-alice" } }),
    env,
  );
  assert.equal(res.status, 200);
  const body = await res.json() as { plan: string; dailyLimit: number };
  assert.equal(body.plan, "pro");
  assert.equal(body.dailyLimit, 5000);
});

test("Worker: dashboard shows only self unless tenant is an explicit admin", async () => {
  const kv = new MemKV();
  const store = new KvTenantStore(kv);
  // Two ordinary signup-style customers ("*"-scoped, NOT admins) + one operator.
  await store.upsert({ key: "sk-alice", name: "alice", repos: "*", plan: "pro" });
  await store.upsert({ key: "sk-bob", name: "bob", repos: "*", plan: "free" });
  await store.upsert({ key: "sk-ops", name: "ops", repos: "*", plan: "enterprise", admin: true });
  const env = { CTX_KV: kv };

  const asAlice = await worker.fetch(
    new Request("https://ctx.example.com/v1/dashboard/data", { headers: { authorization: "Bearer sk-alice" } }),
    env,
  );
  const aliceView = await asAlice.json() as { tenants: { name: string }[] };
  assert.deepEqual(aliceView.tenants.map((t) => t.name), ["alice"], "a customer must never see other customers");

  const asOps = await worker.fetch(
    new Request("https://ctx.example.com/v1/dashboard/data", { headers: { authorization: "Bearer sk-ops" } }),
    env,
  );
  const opsView = await asOps.json() as { tenants: { name: string }[] };
  assert.equal(opsView.tenants.length, 3, "the explicit admin sees everyone");
});

test("Worker: a malformed STRIPE_PRICE_MAP degrades gracefully instead of 500ing every route", async () => {
  const env = { CTX_KV: new MemKV(), STRIPE_PRICE_MAP: "{not json" };
  const health = await worker.fetch(new Request("https://ctx.example.com/v1/health"), env);
  assert.equal(health.status, 200);
  const pricing = await worker.fetch(new Request("https://ctx.example.com/pricing"), env);
  assert.equal(pricing.status, 200);
  assert.match(await pricing.text(), /indisponible/, "paid plans render as unavailable, site stays up");
});

test("Worker: /v1/signup/success refuses to hand over the key until the session is paid", async () => {
  // The session id is visible in the Checkout URL before payment, so the
  // success page must gate on Stripe's payment_status, not mere existence.
  const env = { CTX_KV: new MemKV(), CTX_STRIPE_API_KEY: "sk_test_x" };
  const realFetch = globalThis.fetch;
  let paymentStatus = "unpaid";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.startsWith("https://api.stripe.com/v1/checkout/sessions/")) {
      return new Response(JSON.stringify({ client_reference_id: "sk-buyer", payment_status: paymentStatus, status: "open" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    const unpaid = await worker.fetch(new Request("https://ctx.example.com/v1/signup/success?session_id=cs_123"), env);
    assert.equal(unpaid.status, 402);
    const unpaidHtml = await unpaid.text();
    assert.ok(!unpaidHtml.includes("sk-buyer"), "key must not leak before payment");
    assert.ok(!unpaidHtml.includes("Paiement validé"));

    paymentStatus = "paid";
    const paid = await worker.fetch(new Request("https://ctx.example.com/v1/signup/success?session_id=cs_123"), env);
    assert.equal(paid.status, 200);
    const paidHtml = await paid.text();
    assert.ok(paidHtml.includes("sk-buyer"));
    assert.ok(paidHtml.includes("Paiement validé"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("verifyStripeSignatureWeb matches an openssl-style signature", async () => {
  const secret = "whsec_test";
  const payload = '{"hello":"world"}';
  const now = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${now}.${payload}`).digest("hex");
  const header = `t=${now},v1=${sig}`;
  assert.equal(await verifyStripeSignatureWeb(payload, header, secret), true);
  assert.equal(await verifyStripeSignatureWeb("tampered", header, secret), false);
  assert.equal(await verifyStripeSignatureWeb(payload, header, "wrong"), false);
  assert.equal(await verifyStripeSignatureWeb(payload, null, secret), false);
});

test("newTenantKey produces a distinct sk- prefixed key each call", () => {
  const a = newTenantKey();
  const b = newTenantKey();
  assert.match(a, /^sk-[0-9a-f]{48}$/);
  assert.notEqual(a, b);
});
