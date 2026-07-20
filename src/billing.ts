import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Billing layer: maps subscription plans to daily quotas and wires Stripe
 * subscription state onto the existing tenant metering. The plan a tenant is
 * on decides its dailyLimit; Stripe webhooks flip a tenant's plan when a
 * subscription is created, updated or cancelled.
 *
 * Plans mirror the pricing tiers in the master doc.
 */

export type PlanId = "free" | "pro" | "team" | "enterprise";

export interface Plan {
  id: PlanId;
  name: string;
  /** Daily request quota; null = unlimited. */
  dailyLimit: number | null;
  /** Max repos a tenant on this plan may register; null = unlimited. */
  repoLimit: number | null;
  /** Whether semantic search (embeddings) is included. */
  semantic: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free / OSS", dailyLimit: 200, repoLimit: 1, semantic: false },
  pro: { id: "pro", name: "Pro", dailyLimit: 5000, repoLimit: 5, semantic: true },
  team: { id: "team", name: "Team", dailyLimit: 50000, repoLimit: null, semantic: true },
  enterprise: { id: "enterprise", name: "Enterprise", dailyLimit: null, repoLimit: null, semantic: true },
};

export function planFor(id: string | undefined): Plan {
  return PLANS[(id as PlanId) ?? "free"] ?? PLANS.free;
}

/**
 * Map a Stripe Price ID (or lookup key) to a plan. Configured via
 * STRIPE_PRICE_MAP env (JSON: {"price_123": "pro", ...}) so the same code
 * runs against test and live prices without edits.
 */
export function planForPrice(priceId: string | undefined, priceMap: Record<string, PlanId>): PlanId {
  if (!priceId) return "free";
  return priceMap[priceId] ?? "free";
}

export function loadPriceMap(raw: string | undefined): Record<string, PlanId> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, PlanId>;
  for (const [price, plan] of Object.entries(parsed)) {
    if (!PLANS[plan]) throw new Error(`STRIPE_PRICE_MAP: '${price}' maps to unknown plan '${plan}'`);
  }
  return parsed;
}

/**
 * Verify a Stripe webhook signature (t=…,v1=… scheme) without pulling the
 * Stripe SDK: HMAC-SHA256 over `${timestamp}.${payload}` with the endpoint
 * secret, constant-time compared. Rejects timestamps older than `toleranceSec`
 * to block replay.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | undefined,
  secret: string,
  toleranceSec = 300,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v];
    }),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  if (Math.abs(now - timestamp) > toleranceSec) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"));
}

export interface StripeSubscriptionEvent {
  type: string;
  data: { object: StripeSubscriptionObject };
}

interface StripeSubscriptionObject {
  id: string;
  status: string;
  /** We stash the tenant key in subscription metadata at checkout. */
  metadata?: { tenant_key?: string };
  customer?: string;
  items?: { data: { price: { id: string } }[] };
}

export type SubscriptionOutcome =
  | { action: "set-plan"; tenantKey: string; plan: PlanId; stripeCustomerId?: string }
  | { action: "downgrade"; tenantKey: string; plan: "free"; stripeCustomerId?: string }
  | { action: "ignored"; reason: string };

/**
 * Translate a Stripe subscription webhook event into a plan change for a
 * tenant. Active/trialing → the plan behind the subscription's price;
 * canceled/unpaid → downgrade to free. Other events are ignored.
 */
export function resolveSubscriptionEvent(
  event: StripeSubscriptionEvent,
  priceMap: Record<string, PlanId>,
): SubscriptionOutcome {
  const sub = event.data.object;
  const tenantKey = sub.metadata?.tenant_key;
  if (!tenantKey) return { action: "ignored", reason: "no tenant_key in subscription metadata" };
  // Spread conditionally rather than always setting the key to `undefined` —
  // keeps the outcome shape clean when a test/event omits `customer`.
  const withCustomer = sub.customer ? { stripeCustomerId: sub.customer } : {};

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      if (sub.status === "active" || sub.status === "trialing") {
        const priceId = sub.items?.data?.[0]?.price?.id;
        return { action: "set-plan", tenantKey, plan: planForPrice(priceId, priceMap), ...withCustomer };
      }
      if (sub.status === "canceled" || sub.status === "unpaid" || sub.status === "past_due") {
        return { action: "downgrade", tenantKey, plan: "free", ...withCustomer };
      }
      return { action: "ignored", reason: `subscription status '${sub.status}' not actionable` };
    }
    case "customer.subscription.deleted":
      return { action: "downgrade", tenantKey, plan: "free", ...withCustomer };
    default:
      return { action: "ignored", reason: `event '${event.type}' not handled` };
  }
}
