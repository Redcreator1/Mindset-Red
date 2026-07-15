import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContextServer } from "../server.js";
import { TenantStore } from "../tenants.js";
import { indexCommits, writeMemory } from "../memory.js";
import { bootstrapStripePlans, DEFAULT_PLAN_SPECS } from "../checkout.js";
import { renderPricing } from "../pricing.js";

/**
 * A minimal Stripe REST mock: enough surface to test the self-service signup
 * flow (Checkout create + retrieve) and the plan bootstrap (products/prices
 * search + create). The whole real interaction is over plain fetch, so a
 * plain http.Server replacement is sufficient.
 */
function startStripeMock(): Promise<{ baseURL: string; server: Server; state: { products: string[]; prices: Record<string, unknown>[]; sessions: Record<string, { client_reference_id: string }> } }> {
  const state = { products: [] as string[], prices: [] as Record<string, unknown>[], sessions: {} as Record<string, { client_reference_id: string }> };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, obj: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    // Checkout create.
    if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const params = new URLSearchParams(body);
      const id = `cs_test_${Math.random().toString(36).slice(2, 10)}`;
      const clientRef = params.get("client_reference_id") ?? "";
      state.sessions[id] = { client_reference_id: clientRef };
      return send(200, { id, url: `https://checkout.stripe.com/test/${id}` });
    }
    // Checkout retrieve.
    const csMatch = req.method === "GET" && url.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
    if (csMatch) {
      const s = state.sessions[csMatch[1]];
      return s ? send(200, s) : send(404, { error: "not found" });
    }
    // Products list + create.
    if (req.method === "GET" && url.pathname === "/v1/products") {
      return send(200, { data: state.products.map((name, i) => ({ id: `prod_${i}`, name })) });
    }
    if (req.method === "POST" && url.pathname === "/v1/products") {
      const params = new URLSearchParams(body);
      state.products.push(params.get("name")!);
      return send(200, { id: `prod_${state.products.length - 1}` });
    }
    // Prices list + create.
    if (req.method === "GET" && url.pathname === "/v1/prices") {
      const product = url.searchParams.get("product");
      return send(200, { data: state.prices.filter((p) => p.product === product) });
    }
    if (req.method === "POST" && url.pathname === "/v1/prices") {
      const params = new URLSearchParams(body);
      const id = `price_${state.prices.length}`;
      const price = {
        id,
        product: params.get("product"),
        unit_amount: Number(params.get("unit_amount")),
        currency: params.get("currency"),
        recurring: { interval: params.get("recurring[interval]") },
      };
      state.prices.push(price);
      return send(200, { id });
    }
    send(404, { error: `mock: unhandled ${req.method} ${url.pathname}` });
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ baseURL: `http://127.0.0.1:${port}`, server, state });
    });
  });
}

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

test("public /pricing renders without auth and mentions private repos", () => {
  const html = renderPricing({ baseUrl: "https://example.com", availablePlans: new Set(["pro"]) });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("mindset-ctx"));
  assert.ok(html.includes("Passer Pro"));
  assert.ok(html.match(/repos\s+priv/i), "reassures about private repos");
});

test("full public signup flow: pricing → signup redirects to Stripe → success returns the key", async () => {
  const stripe = await startStripeMock();
  const repo = makeRepo("signup");
  const store = new TenantStore([]);
  const server = createContextServer({ signup: repo }, {
    tenantStore: store,
    appBaseUrl: "http://ctx.local",
    stripeApiKey: "sk_test_x",
    stripeBaseURL: stripe.baseURL,
    stripePriceMap: { price_pro_test: "pro" },
  });
  const base = await listen(server);

  try {
    // /pricing is publicly reachable.
    const pricing = await fetch(`${base}/pricing`);
    assert.equal(pricing.status, 200);
    assert.match(await pricing.text(), /Passer Pro/);

    // / is the vitrine, not the pricing page and not the health JSON that
    // used to shadow it (a real bug: both branches checked path === "/",
    // but the health-check branch was listed first, so / never reached
    // pricing at all until this was split into three distinct routes).
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    const homeBody = await home.text();
    assert.ok(homeBody.startsWith("<!doctype html>"));
    assert.ok(!homeBody.includes("Passer Pro"));
    // Open Graph / Twitter Card tags — a link to / shared on X/Slack shows a
    // real preview instead of a bare URL, using the appBaseUrl passed above.
    assert.match(homeBody, /<meta property="og:image" content="http:\/\/ctx\.local\/og-image\.png">/);
    assert.match(homeBody, /<meta name="twitter:card" content="summary_large_image">/);

    // The OG image itself is served, self-hosted — no third-party asset.
    const ogImage = await fetch(`${base}/og-image.png`);
    assert.equal(ogImage.status, 200);
    assert.equal(ogImage.headers.get("content-type"), "image/png");

    // /v1/health still returns its own JSON, unaffected by the split.
    const health = await fetch(`${base}/v1/health`);
    assert.equal((await health.json() as { ok: boolean }).ok, true);

    // /docs renders the documentation index.
    const docs = await fetch(`${base}/docs`);
    assert.equal(docs.status, 200);
    assert.match(await docs.text(), /Documentation/);

    // /blog lists posts; /blog/:slug renders one; unknown slugs 404 (styled HTML, not JSON).
    const blogIndex = await fetch(`${base}/blog`);
    assert.equal(blogIndex.status, 200);
    assert.match(await blogIndex.text(), /href="\/blog\/infrastructure-de-contexte-pour-agents-ia"/);
    const blogPost = await fetch(`${base}/blog/infrastructure-de-contexte-pour-agents-ia`);
    assert.equal(blogPost.status, 200);
    assert.match(await blogPost.text(), /mindset-ctx/);
    const missingPost = await fetch(`${base}/blog/does-not-exist`);
    assert.equal(missingPost.status, 404);
    assert.match(await missingPost.text(), /<!doctype html>/);

    // /favicon.svg is served; the legacy /favicon.ico request redirects to it.
    const favicon = await fetch(`${base}/favicon.svg`);
    assert.equal(favicon.status, 200);
    assert.equal(favicon.headers.get("content-type"), "image/svg+xml");
    const faviconIco = await fetch(`${base}/favicon.ico`, { redirect: "manual" });
    assert.equal(faviconIco.status, 302);
    assert.equal(faviconIco.headers.get("location"), "/favicon.svg");

    // robots.txt / sitemap.xml for search engines.
    const robots = await fetch(`${base}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /Disallow: \/v1\//);
    const sitemap = await fetch(`${base}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    assert.equal(sitemap.headers.get("content-type"), "application/xml; charset=utf-8");
    assert.match(await sitemap.text(), /<loc>http:\/\/ctx\.local\/blog<\/loc>/);

    // An unknown page gets a styled 404 — crucially NOT "401 unauthorized",
    // which is what an unauthenticated request used to get here (tenant auth
    // is configured on this server via tenantStore, the same as production):
    // the auth gate used to run before routing had a chance to say "not found".
    const unknownPage = await fetch(`${base}/this-page-does-not-exist`);
    assert.equal(unknownPage.status, 404);
    assert.match(await unknownPage.text(), /<!doctype html>/);

    // /v1/signup mints a tenant, calls Stripe, redirects to Checkout.
    const signup = await fetch(`${base}/v1/signup?plan=pro`, { redirect: "manual" });
    assert.equal(signup.status, 302);
    assert.match(signup.headers.get("location") ?? "", /checkout\.stripe\.com/);
    assert.equal(store.all().length, 1, "one free tenant provisioned");
    const tenant = store.all()[0];
    assert.equal(tenant.plan, "free");

    // The mock recorded exactly one checkout session with the right client_reference_id.
    const sessionIds = Object.keys(stripe.state.sessions);
    assert.equal(sessionIds.length, 1);
    assert.equal(stripe.state.sessions[sessionIds[0]].client_reference_id, tenant.key);

    // The success page fetches Stripe and shows the tenant key exactly once.
    const success = await fetch(`${base}/v1/signup/success?session_id=${sessionIds[0]}`);
    assert.equal(success.status, 200);
    const html = await success.text();
    assert.ok(html.includes(tenant.key), "tenant key is displayed to the buyer");
    assert.match(html, /Paiement validé/);
  } finally {
    server.close();
    stripe.server.close();
  }
});

test("/v1/signup rejects unknown or free plans and requires Stripe config", async () => {
  const repo = makeRepo("signup-guards");
  const store = new TenantStore([]);

  // No stripeApiKey → 503.
  const bare = createContextServer({ signup: repo }, { tenantStore: store });
  const bareBase = await listen(bare);
  try {
    assert.equal((await fetch(`${bareBase}/v1/signup?plan=pro`)).status, 503);
  } finally {
    bare.close();
  }

  // Configured but unknown / free plans are 400.
  const stripe = await startStripeMock();
  const configured = createContextServer({ signup: repo }, {
    tenantStore: store,
    stripeApiKey: "sk_test_x",
    stripeBaseURL: stripe.baseURL,
    stripePriceMap: { price_pro_test: "pro" },
  });
  const base = await listen(configured);
  try {
    assert.equal((await fetch(`${base}/v1/signup?plan=free`)).status, 400);
    assert.equal((await fetch(`${base}/v1/signup?plan=platinum`)).status, 400);
  } finally {
    configured.close();
    stripe.server.close();
  }
});

test("bootstrapStripePlans is idempotent and prints a usable STRIPE_PRICE_MAP", async () => {
  const stripe = await startStripeMock();
  try {
    const first = await bootstrapStripePlans("sk_test_x", DEFAULT_PLAN_SPECS, stripe.baseURL);
    // Two plans → two prices.
    assert.equal(Object.keys(first).length, 2);
    assert.deepEqual(new Set(Object.values(first)), new Set(["pro", "team"]));

    const productsAfterFirst = stripe.state.products.length;
    const pricesAfterFirst = stripe.state.prices.length;

    // Re-run: no new products or prices created.
    const second = await bootstrapStripePlans("sk_test_x", DEFAULT_PLAN_SPECS, stripe.baseURL);
    assert.deepEqual(second, first);
    assert.equal(stripe.state.products.length, productsAfterFirst);
    assert.equal(stripe.state.prices.length, pricesAfterFirst);
  } finally {
    stripe.server.close();
  }
});
