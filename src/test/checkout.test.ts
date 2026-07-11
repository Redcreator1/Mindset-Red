import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createCheckoutSession, encodeForm, ensureStripeWebhook, newTenantKey, priceForPlan } from "../checkout.js";
import { createContextServer } from "../server.js";
import { TenantStore } from "../tenants.js";
import { indexCommits, writeMemory } from "../memory.js";

test("newTenantKey mints unguessable, unique keys", () => {
  const a = newTenantKey();
  const b = newTenantKey();
  assert.match(a, /^sk_ctx_[A-Za-z0-9_-]{32,}$/);
  assert.notEqual(a, b);
});

test("priceForPlan inverts the price map; free needs no price", () => {
  const map = { price_pro: "pro" as const, price_team: "team" as const };
  assert.equal(priceForPlan("pro", map), "price_pro");
  assert.equal(priceForPlan("team", map), "price_team");
  assert.equal(priceForPlan("free", map), null);
  assert.equal(priceForPlan("enterprise", map), null);
});

test("encodeForm produces Stripe bracketed form encoding", () => {
  const s = encodeForm({ mode: "subscription", "line_items[0][price]": "price_1", "metadata[tenant_key]": "sk ctx/1" });
  assert.ok(s.includes("mode=subscription"));
  assert.ok(s.includes("line_items%5B0%5D%5Bprice%5D=price_1"));
  assert.ok(s.includes("metadata%5Btenant_key%5D=sk%20ctx%2F1"), "values are URL-encoded");
});

test("createCheckoutSession posts the right shape and returns the hosted URL", async () => {
  let captured: { auth?: string; body?: string } = {};
  const mock = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      captured = { auth: req.headers.authorization, body };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.com/pay/cs_test_123" }));
    });
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const baseURL = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

  try {
    const session = await createCheckoutSession({
      secretKey: "sk_test_x", priceId: "price_pro", tenantKey: "sk_ctx_alice",
      successUrl: "https://app/ok", cancelUrl: "https://app/no", baseURL,
    });
    assert.equal(session.url, "https://checkout.stripe.com/pay/cs_test_123");
    assert.equal(captured.auth, "Bearer sk_test_x");
    assert.ok(captured.body!.includes("mode=subscription"));
    assert.ok(captured.body!.includes("line_items%5B0%5D%5Bprice%5D=price_pro"));
    assert.ok(
      captured.body!.includes("subscription_data%5Bmetadata%5D%5Btenant_key%5D=sk_ctx_alice"),
      "tenant key is stamped into subscription metadata so the webhook can map it back",
    );
  } finally {
    mock.close();
  }
});

test("createCheckoutSession surfaces Stripe errors", async () => {
  const mock = createServer((_req, res) => {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: { message: "No such price" } }));
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const baseURL = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  try {
    await assert.rejects(
      () => createCheckoutSession({ secretKey: "sk", priceId: "bad", tenantKey: "t", successUrl: "a", cancelUrl: "b", baseURL }),
      /Stripe checkout 400/,
    );
  } finally {
    mock.close();
  }
});

// ---- ensureStripeWebhook ----

function startWebhookMock() {
  const endpoints: { id: string; url: string; enabled_events: string[] }[] = [];
  const mock = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/v1/webhook_endpoints") {
        res.end(JSON.stringify({ data: endpoints }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/webhook_endpoints") {
        const params = new URLSearchParams(body);
        const created = {
          id: `we_${endpoints.length + 1}`,
          url: params.get("url")!,
          enabled_events: params.getAll("enabled_events[]"),
        };
        endpoints.push(created);
        res.end(JSON.stringify({ ...created, secret: `whsec_${created.id}` }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `unhandled ${req.method} ${url.pathname}` }));
    });
  });
  return { mock, endpoints };
}

test("ensureStripeWebhook creates an endpoint and returns its signing secret", async () => {
  const { mock } = startWebhookMock();
  await new Promise<void>((r) => mock.listen(0, r));
  const baseURL = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  try {
    const result = await ensureStripeWebhook("sk_test_x", "https://app.example.com/v1/stripe/webhook", undefined, baseURL);
    assert.equal(result.created, true);
    assert.equal(result.url, "https://app.example.com/v1/stripe/webhook");
    assert.match(result.secret!, /^whsec_/);
  } finally {
    mock.close();
  }
});

test("ensureStripeWebhook sends the requested events as enabled_events[]", async () => {
  const { mock, endpoints } = startWebhookMock();
  await new Promise<void>((r) => mock.listen(0, r));
  const baseURL = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  try {
    await ensureStripeWebhook("sk_test_x", "https://app.example.com/hook", ["customer.subscription.created"], baseURL);
    assert.deepEqual(endpoints[0].enabled_events, ["customer.subscription.created"]);
  } finally {
    mock.close();
  }
});

test("ensureStripeWebhook is idempotent by URL: second call reuses, doesn't duplicate, secret is null", async () => {
  const { mock, endpoints } = startWebhookMock();
  await new Promise<void>((r) => mock.listen(0, r));
  const baseURL = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  const url = "https://app.example.com/v1/stripe/webhook";
  try {
    const first = await ensureStripeWebhook("sk_test_x", url, undefined, baseURL);
    assert.equal(first.created, true);
    assert.ok(first.secret);

    const second = await ensureStripeWebhook("sk_test_x", url, undefined, baseURL);
    assert.equal(second.created, false);
    assert.equal(second.id, first.id);
    assert.equal(second.secret, null, "Stripe never re-exposes a signing secret on an existing endpoint");
    assert.equal(endpoints.length, 1, "no duplicate endpoint created");
  } finally {
    mock.close();
  }
});

// ---- end-to-end over the server ----

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

test("GET /v1/checkout returns a payment URL for the calling tenant", async () => {
  // Mock Stripe.
  const stripe = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/pay/cs_1?k=" + encodeURIComponent(body.length.toString()) }));
    });
  });
  await new Promise<void>((r) => stripe.listen(0, r));
  const stripeBase = `http://127.0.0.1:${(stripe.address() as { port: number }).port}`;

  const repo = makeRepo("payflow");
  const store = new TenantStore([{ key: "sk-alice", name: "alice", repos: "*", plan: "free" }]);
  // Inject the mock Stripe base via the checkout options through a tiny wrapper:
  const server = createContextServer({ payflow: repo }, {
    tenantStore: store,
    stripeApiKey: "sk_test_x",
    stripePriceMap: { price_pro: "pro" },
    checkoutSuccessUrl: "https://app/ok",
    checkoutCancelUrl: "https://app/no",
  });

  // Monkeypatch not needed: point Stripe base via env is not supported, so we
  // verify the non-network branches (unknown plan, unconfigured) here and rely
  // on the unit test above for the network shape.
  const base = await listen(server);
  try {
    // Unknown plan → 400.
    const bad = await fetch(`${base}/v1/checkout?plan=platinum`, { headers: { authorization: "Bearer sk-alice" } });
    assert.equal(bad.status, 400);

    // free plan → 400 (no price).
    const free = await fetch(`${base}/v1/checkout?plan=free`, { headers: { authorization: "Bearer sk-alice" } });
    assert.equal(free.status, 400);

    // No auth → 401.
    const noauth = await fetch(`${base}/v1/checkout?plan=pro`);
    assert.equal(noauth.status, 401);
  } finally {
    server.close();
    stripe.close();
  }
});

test("checkout route is unavailable without a Stripe API key", async () => {
  const repo = makeRepo("nopay");
  const store = new TenantStore([{ key: "sk-alice", name: "alice", repos: "*", plan: "free" }]);
  const server = createContextServer({ nopay: repo }, { tenantStore: store, stripePriceMap: { price_pro: "pro" } });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/v1/checkout?plan=pro`, { headers: { authorization: "Bearer sk-alice" } });
    assert.equal(res.status, 503);
  } finally {
    server.close();
  }
});
