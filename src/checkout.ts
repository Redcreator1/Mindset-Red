import { randomBytes } from "node:crypto";
import type { PlanId } from "./billing.js";

/**
 * The payment front door: create a Stripe Checkout Session so a developer can
 * actually subscribe. This is the missing half of the billing loop — the
 * Stripe webhook (billing.ts) already flips a tenant's plan once a
 * subscription exists; this creates that subscription.
 *
 * Flow:
 *   1. A new tenant gets an API key (newTenantKey()).
 *   2. createCheckoutSession() returns a Stripe-hosted payment URL, stamping
 *      the tenant key into subscription metadata.
 *   3. The dev pays; Stripe fires customer.subscription.created with that
 *      tenant_key; our webhook upgrades the tenant's plan. Loop closed.
 *
 * Zero-dependency: talks to the Stripe REST API with fetch and form encoding,
 * no stripe-node SDK.
 */

/** Mint a fresh, unguessable tenant API key. */
export function newTenantKey(): string {
  return "sk_ctx_" + randomBytes(24).toString("base64url");
}

export interface CheckoutOptions {
  secretKey: string;
  /** Stripe Price ID to subscribe to (one of your plan prices). */
  priceId: string;
  /** The tenant key this subscription pays for (stamped into metadata). */
  tenantKey: string;
  successUrl: string;
  cancelUrl: string;
  /** Override for tests. Default: https://api.stripe.com */
  baseURL?: string;
}

/** Encode a flat/nested object as Stripe's bracketed form syntax. */
export function encodeForm(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/**
 * Create a subscription-mode Checkout Session and return its hosted URL.
 * The tenant key rides in subscription_data[metadata][tenant_key] so the
 * webhook can map the resulting subscription back to the tenant.
 */
export async function createCheckoutSession(opts: CheckoutOptions): Promise<{ id: string; url: string }> {
  const baseURL = (opts.baseURL ?? "https://api.stripe.com").replace(/\/+$/, "");
  const body = encodeForm({
    mode: "subscription",
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": "1",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "subscription_data[metadata][tenant_key]": opts.tenantKey,
    // Also stamp the key on the session itself, so a manual reconciliation
    // (or checkout.session.completed handler) can find it too.
    "metadata[tenant_key]": opts.tenantKey,
    client_reference_id: opts.tenantKey,
  });

  const res = await fetch(`${baseURL}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`Stripe checkout ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const session = (await res.json()) as { id: string; url: string };
  return { id: session.id, url: session.url };
}

/**
 * Resolve which Stripe Price to charge for a requested plan, using the same
 * price→plan map the webhook uses (inverted). Returns null for free/unknown.
 */
export function priceForPlan(plan: PlanId, priceMap: Record<string, PlanId>): string | null {
  if (plan === "free") return null;
  const entry = Object.entries(priceMap).find(([, p]) => p === plan);
  return entry ? entry[0] : null;
}

/** Plan → Stripe product + price definition used by the bootstrap step. */
export interface StripePlanSpec {
  plan: PlanId;
  name: string;
  amountCents: number;
  currency: string;
  interval: "month" | "year";
}

export const DEFAULT_PLAN_SPECS: StripePlanSpec[] = [
  { plan: "pro", name: "mindset-ctx Pro", amountCents: 1900, currency: "eur", interval: "month" },
  { plan: "team", name: "mindset-ctx Team", amountCents: 9900, currency: "eur", interval: "month" },
];

/**
 * Bootstrap products + prices in the Stripe account and return the price→plan
 * map ready to feed STRIPE_PRICE_MAP. Idempotent by product `name`: existing
 * products are reused (via a search) so re-running doesn't create duplicates.
 * Zero-dep: two REST calls per plan.
 */
export async function bootstrapStripePlans(
  secretKey: string,
  specs: StripePlanSpec[] = DEFAULT_PLAN_SPECS,
  baseURL = "https://api.stripe.com",
): Promise<Record<string, PlanId>> {
  const map: Record<string, PlanId> = {};
  for (const spec of specs) {
    const productId = await ensureProduct(secretKey, spec.name, baseURL);
    const priceId = await ensurePrice(secretKey, productId, spec, baseURL);
    map[priceId] = spec.plan;
  }
  return map;
}

async function ensureProduct(secretKey: string, name: string, baseURL: string): Promise<string> {
  // Try to find an existing product by exact name.
  const search = await stripeGet<{ data: { id: string; name: string }[] }>(
    secretKey,
    `${baseURL}/v1/products?active=true&limit=100`,
  );
  const existing = search.data.find((p) => p.name === name);
  if (existing) return existing.id;
  const created = await stripePost<{ id: string }>(secretKey, `${baseURL}/v1/products`, { name });
  return created.id;
}

async function ensurePrice(secretKey: string, productId: string, spec: StripePlanSpec, baseURL: string): Promise<string> {
  // Reuse a matching active recurring price on the product if it exists.
  const prices = await stripeGet<{ data: { id: string; unit_amount: number; currency: string; recurring: { interval: string } | null }[] }>(
    secretKey,
    `${baseURL}/v1/prices?product=${productId}&active=true&limit=100`,
  );
  const match = prices.data.find(
    (p) => p.unit_amount === spec.amountCents && p.currency === spec.currency && p.recurring?.interval === spec.interval,
  );
  if (match) return match.id;
  const created = await stripePost<{ id: string }>(secretKey, `${baseURL}/v1/prices`, {
    product: productId,
    unit_amount: String(spec.amountCents),
    currency: spec.currency,
    "recurring[interval]": spec.interval,
  });
  return created.id;
}

async function stripeGet<T>(secretKey: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${secretKey}` } });
  if (!res.ok) throw new Error(`Stripe GET ${url} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

async function stripePost<T>(secretKey: string, url: string, fields: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: encodeForm(fields),
  });
  if (!res.ok) throw new Error(`Stripe POST ${url} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}
