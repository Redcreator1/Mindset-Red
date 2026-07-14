import { renderPricing, renderSuccess } from "../pricing.js";
import { renderHome, renderDocs } from "../home.js";
import { renderDashboard, summarizeTenant, type DashboardData } from "../dashboard.js";
import { createCheckoutSession, priceForPlan } from "../checkout.js";
import { PLANS, resolveSubscriptionEvent, loadPriceMap, type PlanId } from "../billing.js";
import { verifyStripeSignatureWeb } from "./hmac.js";
import {
  KvTenantStore,
  KvUsageMeter,
  newTenantKey,
  isValidPlan,
  type KVLike,
} from "./kv.js";

/**
 * Cloudflare Workers entry — the hosted funnel (pricing, signup, Stripe,
 * dashboard, usage). Multi-tenant state lives in a KV namespace; billing
 * follows the same model as the Node server (plan → daily quota, subscription
 * webhooks flip the plan, /v1/usage exposes the meter).
 *
 * The heavy repo-side features (analyze/generate/index/MCP/memory search)
 * stay in the CLI — this Worker is purely the customer-facing hosted plane
 * so the deployment stays lightweight and edge-fast.
 */

export interface Env {
  CTX_KV: KVLike;
  CTX_STRIPE_API_KEY?: string;
  CTX_STRIPE_SECRET?: string;
  STRIPE_PRICE_MAP?: string;
  CTX_BASE_URL?: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function requestKey(req: Request): string | undefined {
  const bearer = req.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) return bearer.slice("Bearer ".length);
  return req.headers.get("x-api-key") ?? undefined;
}

function stripeBaseUrl(): string {
  return "https://api.stripe.com";
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const store = new KvTenantStore(env.CTX_KV);
    const meter = new KvUsageMeter(env.CTX_KV);
    // A malformed STRIPE_PRICE_MAP secret must not take the whole site down
    // (this runs before any routing, including /pricing and /v1/health) —
    // degrade to "no plans purchasable" instead, which /pricing renders as
    // disabled buttons.
    let priceMap: Record<string, PlanId>;
    try {
      priceMap = loadPriceMap(env.STRIPE_PRICE_MAP);
    } catch {
      priceMap = {};
    }
    // `||` (not `??`) on purpose: an unset CTX_BASE_URL var deploys as "" in
    // Cloudflare, not undefined, so `??` would never fall through and every
    // Stripe redirect URL would end up relative — which Stripe rejects.
    const baseUrl = env.CTX_BASE_URL || `${url.protocol}//${url.host}`;

    // ---------- Public routes ----------
    // Root domain is the vitrine (thesis, not price list) — the moment a real
    // domain points here, this is what a first-time visitor sees.
    if (path === "/") {
      return html(200, renderHome());
    }

    if (path === "/docs") {
      return html(200, renderDocs());
    }

    if (path === "/pricing") {
      const availablePlans = new Set<PlanId>(Object.values(priceMap));
      return html(200, renderPricing({ baseUrl, availablePlans }));
    }

    if (path === "/v1/health") {
      return json(200, { ok: true, service: "mindset-ctx", edge: "cloudflare-workers" });
    }

    // Self-service signup: mint a fresh tenant key, register free, open a
    // Stripe Checkout Session, redirect. Payment → webhook flips to paid plan.
    if (path === "/v1/signup") {
      if (!env.CTX_STRIPE_API_KEY) return json(503, { error: "signup not configured" });
      const plan = url.searchParams.get("plan") ?? "pro";
      if (!isValidPlan(plan) || plan === "free") {
        return json(400, { error: `plan '${plan}' cannot be purchased` });
      }
      const priceId = priceForPlan(plan, priceMap);
      if (!priceId) return json(400, { error: `no Stripe price mapped for plan '${plan}'` });

      const key = newTenantKey();
      await store.upsert({ key, name: `signup-${key.slice(-8)}`, repos: "*", plan: "free" });
      try {
        const session = await createCheckoutSession({
          secretKey: env.CTX_STRIPE_API_KEY,
          priceId,
          tenantKey: key,
          successUrl: `${baseUrl}/v1/signup/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${baseUrl}/pricing`,
        });
        return Response.redirect(session.url, 302);
      } catch (err) {
        return json(502, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // After payment, look up the Checkout Session to recover the tenant key
    // stamped into client_reference_id and show it to the buyer once.
    if (path === "/v1/signup/success") {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId || !env.CTX_STRIPE_API_KEY) return json(400, { error: "missing session_id" });
      const lookup = await fetch(`${stripeBaseUrl()}/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { authorization: `Bearer ${env.CTX_STRIPE_API_KEY}` },
      });
      if (!lookup.ok) return json(502, { error: `stripe lookup ${lookup.status}` });
      const data = (await lookup.json()) as { client_reference_id?: string; payment_status?: string; status?: string };
      // The session id is visible in the Checkout URL before paying, so anyone
      // can abandon payment and hit this URL directly. Only hand the key over
      // (and claim "payment validated") once Stripe says the session is paid.
      if (data.payment_status !== "paid" && data.status !== "complete") {
        return html(402, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Paiement non finalisé — mindset-ctx</title></head>
<body style="margin:0;font:15px system-ui;background:#0b1220;color:#e2e8f0;padding:48px 32px">
<main style="max-width:640px;margin:0 auto;background:#111a2e;border:1px solid #1e293b;border-radius:14px;padding:32px">
<h1 style="margin:0 0 16px;font-size:22px">⏳ Paiement non finalisé</h1>
<p>Cette session de paiement n'a pas encore été réglée. Si vous venez de payer, patientez quelques secondes puis rafraîchissez cette page.</p>
<p><a href="${baseUrl}/pricing" style="color:#60a5fa">Retour aux tarifs</a></p>
</main></body></html>`);
      }
      return html(200, renderSuccess(data.client_reference_id ?? "(clé introuvable)", baseUrl));
    }

    // Stripe subscription webhook — flips a tenant's plan on billing changes.
    if (path === "/v1/stripe/webhook") {
      if (req.method !== "POST") return json(405, { error: "expects POST" });
      if (!env.CTX_STRIPE_SECRET) return json(503, { error: "stripe secret not configured" });
      const raw = await req.text();
      const ok = await verifyStripeSignatureWeb(raw, req.headers.get("stripe-signature"), env.CTX_STRIPE_SECRET);
      if (!ok) return json(400, { error: "invalid stripe signature" });
      let event;
      try {
        event = JSON.parse(raw) as Parameters<typeof resolveSubscriptionEvent>[0];
      } catch {
        return json(400, { error: "invalid JSON" });
      }
      const outcome = resolveSubscriptionEvent(event, priceMap);
      if (outcome.action === "set-plan" || outcome.action === "downgrade") {
        const applied = await store.setPlan(outcome.tenantKey, outcome.plan);
        return json(200, { ok: true, ...outcome, applied });
      }
      return json(200, { ok: true, ...outcome });
    }

    // ---------- Authenticated routes ----------
    if (req.method !== "GET") return json(405, { error: "method not allowed" });

    const tenant = await store.get(requestKey(req));
    if (!tenant) return json(401, { error: "unauthorized — pass Authorization: Bearer <key>" });
    if (!(await meter.consume(tenant))) {
      return json(429, { error: "daily quota exceeded", ...(await meter.report(tenant)) });
    }

    if (path === "/v1/usage") {
      return json(200, await meter.report(tenant));
    }

    if (path === "/v1/dashboard" || path === "/v1/dashboard/data") {
      // Only an explicitly-flagged admin tenant sees every tenant. Repo scope
      // must never grant this: every self-service signup tenant is "*"-scoped,
      // and the customer list (names, plans, usage) is not public data.
      const visibleTenants = tenant.admin
        ? await Promise.all((await store.list()).map(async (t) => summarizeTenant(t, (await meter.report(t)).requests)))
        : [summarizeTenant(tenant, (await meter.report(tenant)).requests)];
      const data: DashboardData = { service: "mindset-ctx", repos: [], tenants: visibleTenants };
      if (path === "/v1/dashboard/data") return json(200, data);
      return html(200, renderDashboard(data));
    }

    return json(404, {
      error: "not found",
      routes: ["/pricing", "/v1/health", "/v1/signup?plan=", "/v1/signup/success", "/v1/stripe/webhook", "/v1/usage", "/v1/dashboard"],
    });
  },
};
