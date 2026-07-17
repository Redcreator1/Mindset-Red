import { renderAppInstalled, renderPricing, renderSuccess } from "../pricing.js";
import { renderHome, renderDocs, render404 } from "../home.js";
import { renderBlogIndex, renderBlogPost } from "../blog.js";
import { ogImageBytes } from "../og-image.js";
import { FAVICON_SVG } from "../favicon.js";
import { renderRobotsTxt, renderSitemapXml } from "../seo.js";
import { renderDashboard, summarizeTenant, type DashboardData } from "../dashboard.js";
import { createCheckoutSession, priceForPlan } from "../checkout.js";
import { PLANS, resolveSubscriptionEvent, loadPriceMap, type PlanId } from "../billing.js";
import { buildAppManifest, classifyAppEvent, type AppInstallationEvent } from "../githubapp.js";
import { buildWorkosAuthorizationUrl, exchangeWorkosCode } from "../workos.js";
import {
  buildClearSessionCookieHeader, buildClearStateCookieHeader, buildSessionCookieHeader, buildStateCookieHeader,
  newOauthState, parseCookie, OAUTH_STATE_COOKIE, SESSION_COOKIE,
} from "../session.js";
import { mintSessionTokenWeb, timingSafeEqualStr, verifyGithubSignatureWeb, verifySessionTokenWeb, verifyStripeSignatureWeb } from "./hmac.js";
import {
  KvTenantStore,
  KvUsageMeter,
  newOrgId,
  newTenantKey,
  isValidPlan,
  type KVLike,
  type Organization,
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
  CTX_WEBHOOK_SECRET?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_API_KEY?: string;
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

    // Once a real custom domain is configured, permanently redirect the old
    // *.workers.dev hostname to it (covers both the production and preview
    // subdomains) — preserves links already shared with that URL instead of
    // breaking them, rather than just disabling the subdomain's public
    // visibility in the Cloudflare dashboard.
    if (env.CTX_BASE_URL && url.host.endsWith(".workers.dev") && url.host !== new URL(env.CTX_BASE_URL).host) {
      return Response.redirect(`${env.CTX_BASE_URL}${url.pathname}${url.search}`, 301);
    }

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
      return html(200, renderHome(baseUrl));
    }

    if (path === "/docs") {
      return html(200, renderDocs(baseUrl));
    }

    if (path === "/pricing") {
      const availablePlans = new Set<PlanId>(Object.values(priceMap));
      return html(200, renderPricing({ baseUrl, availablePlans }));
    }

    // Open Graph / Twitter Card preview image — same bytes on both runtimes,
    // embedded in og-image.ts rather than hosted separately (see there for why).
    if (path === "/og-image.png") {
      return new Response(ogImageBytes(), {
        status: 200,
        headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
      });
    }

    if (path === "/favicon.svg") {
      return new Response(FAVICON_SVG, {
        status: 200,
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
      });
    }

    // Browsers request this by default even with a <link rel="icon"> pointing
    // elsewhere — redirect rather than let it fall through to a 404.
    if (path === "/favicon.ico") {
      return new Response(null, { status: 302, headers: { location: "/favicon.svg" } });
    }

    if (path === "/robots.txt") {
      return new Response(renderRobotsTxt(baseUrl), { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    if (path === "/sitemap.xml") {
      return new Response(renderSitemapXml(baseUrl), { status: 200, headers: { "content-type": "application/xml; charset=utf-8" } });
    }

    if (path === "/blog") {
      return html(200, renderBlogIndex(baseUrl));
    }

    const blogMatch = path.match(/^\/blog\/([a-z0-9-]+)$/);
    if (blogMatch) {
      const rendered = renderBlogPost(blogMatch[1], baseUrl);
      if (rendered) return html(200, rendered);
      return new Response(render404(baseUrl), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
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
      // Team is multi-seat by definition — the signing-up tenant becomes the
      // org's owner (able to invite teammates and manage billing) rather than
      // a standalone tenant with its own plan. Pro stays a plain solo tenant.
      if (plan === "team") {
        const orgId = newOrgId();
        await store.upsertOrg({ id: orgId, name: `team-${orgId.slice(-8)}`, repos: "*", plan: "free" });
        await store.upsert({ key, name: `signup-${key.slice(-8)}`, repos: "*", orgId, role: "owner" });
      } else {
        await store.upsert({ key, name: `signup-${key.slice(-8)}`, repos: "*", plan: "free" });
      }
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
        // A team's billing lives on the organization, not the individual
        // tenant who happened to check out — every teammate shares it.
        const billedTenant = await store.get(outcome.tenantKey);
        const applied = billedTenant?.orgId
          ? await store.setOrgPlan(billedTenant.orgId, outcome.plan)
          : await store.setPlan(outcome.tenantKey, outcome.plan);
        return json(200, { ok: true, ...outcome, applied });
      }
      return json(200, { ok: true, ...outcome });
    }

    // GitHub App manifest — public, for one-click App creation.
    if (path === "/v1/app/manifest") {
      return json(200, buildAppManifest(baseUrl));
    }

    // GitHub App lifecycle webhook (installation / installation_repositories).
    // Auto-provisions (or removes) a tenant from the install itself — the
    // App-install equivalent of /v1/signup, no pre-existing account needed.
    if (path === "/v1/app/webhook") {
      if (req.method !== "POST") return json(405, { error: "app webhook expects POST" });
      if (!env.CTX_WEBHOOK_SECRET) return json(503, { error: "webhook secret not configured" });
      const body = await req.text();
      const ok = await verifyGithubSignatureWeb(body, req.headers.get("x-hub-signature-256"), env.CTX_WEBHOOK_SECRET);
      if (!ok) return json(401, { error: "invalid webhook signature" });
      const event = req.headers.get("x-github-event") ?? "unknown";
      if (event === "ping") return json(200, { ok: true, event, action: "pong" });
      let payload: AppInstallationEvent;
      try {
        payload = JSON.parse(body) as AppInstallationEvent;
      } catch {
        return json(400, { error: "invalid JSON payload" });
      }
      const outcome = classifyAppEvent(event, payload);
      if (outcome.kind === "installed") {
        const existing = await store.findByInstallationId(outcome.installationId);
        if (!existing) {
          await store.upsert({
            key: newTenantKey(),
            name: outcome.account,
            repos: outcome.repos.length ? outcome.repos : "*",
            plan: "free",
            installationId: outcome.installationId,
          });
        }
      } else if (outcome.kind === "uninstalled") {
        const installed = await store.findByInstallationId(outcome.installationId);
        if (installed) await store.remove(installed.key);
      } else if (outcome.kind === "repos-added" || outcome.kind === "repos-removed") {
        const installed = await store.findByInstallationId(outcome.installationId);
        if (installed && installed.repos !== "*") {
          const scoped = new Set(installed.repos);
          for (const r of outcome.repos) {
            if (outcome.kind === "repos-added") scoped.add(r);
            else scoped.delete(r);
          }
          await store.upsert({ ...installed, repos: [...scoped] });
        }
      }
      return json(200, { ok: true, event, outcome });
    }

    // Browser lands here right after installing the GitHub App (the
    // manifest's redirect_url). The webhook above usually arrives first and
    // already minted the tenant; look it up by installation id and hand over
    // the key exactly once, mirroring the Stripe /v1/signup/success page.
    if (path === "/v1/app/installed") {
      const rawInstallationId = url.searchParams.get("installation_id") ?? "";
      const installationId = Number(rawInstallationId);
      const tenant = installationId ? await store.findByInstallationId(installationId) : null;
      const refreshHref = `${path}?${new URLSearchParams({ installation_id: rawInstallationId }).toString()}`;
      return html(
        tenant ? 200 : 202,
        tenant
          ? renderAppInstalled({ tenantKey: tenant.key, account: tenant.name, repos: tenant.repos })
          : `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Installation en cours — mindset-ctx</title>
             <meta http-equiv="refresh" content="2;url=${refreshHref}"></head>
             <body style="margin:0;font:15px system-ui;background:#0b1220;color:#e2e8f0;padding:48px 32px">
             <main style="max-width:640px;margin:0 auto;background:#111a2e;border:1px solid #1e293b;border-radius:14px;padding:32px">
             <h1 style="margin:0 0 16px;font-size:22px">⏳ Installation en cours de finalisation</h1>
             <p>GitHub nous a confirmé l'installation ; on attend juste la confirmation du webhook, quelques secondes en général.</p>
             <p>Cette page se rafraîchit automatiquement — vous pouvez aussi <a href="${refreshHref}" style="color:#60a5fa">cliquer ici</a>.</p>
             </main></body></html>`,
      );
    }

    // SSO login (WorkOS AuthKit) — sends the browser to WorkOS's hosted login.
    // Optional ?org=<workos_organization_id> scopes it to one company's SSO
    // connection; omitted, WorkOS shows its general AuthKit login screen.
    if (path === "/v1/sso/login") {
      if (!env.WORKOS_CLIENT_ID) return json(503, { error: "SSO not configured — set WORKOS_CLIENT_ID" });
      // OAuth state: a fresh nonce, echoed back by WorkOS and checked at the
      // callback against this cookie — blocks login-CSRF (an attacker forcing
      // a victim's browser through the callback with the attacker's code).
      const state = newOauthState();
      const authUrl = buildWorkosAuthorizationUrl({
        clientId: env.WORKOS_CLIENT_ID,
        redirectUri: `${baseUrl}/v1/sso/callback`,
        organizationId: url.searchParams.get("org") ?? undefined,
        state,
      });
      return new Response(null, {
        status: 302,
        headers: { location: authUrl, "set-cookie": buildStateCookieHeader(state) },
      });
    }

    // SSO callback — exchanges WorkOS's one-time code for the user's identity,
    // auto-provisions an org (first login for a company) and/or a tenant seat
    // (first login for that person), then sets a signed session cookie. This
    // is the SSO equivalent of /v1/signup and /v1/app/webhook: no pre-existing
    // account needed, the identity provider login itself grants access.
    if (path === "/v1/sso/callback") {
      if (!env.WORKOS_CLIENT_ID || !env.WORKOS_API_KEY) return json(503, { error: "SSO not configured" });
      const code = url.searchParams.get("code");
      if (!code) return json(400, { error: "missing code" });
      // The state echoed by WorkOS must match the nonce we set at login —
      // otherwise this callback wasn't started by this browser. Reject it.
      const returnedState = url.searchParams.get("state") ?? "";
      const cookieState = parseCookie(req.headers.get("cookie"), OAUTH_STATE_COOKIE) ?? "";
      if (!returnedState || !timingSafeEqualStr(returnedState, cookieState)) {
        return json(403, { error: "state mismatch — restart the login from /v1/sso/login" });
      }
      let identity;
      try {
        identity = await exchangeWorkosCode({ clientId: env.WORKOS_CLIENT_ID, apiKey: env.WORKOS_API_KEY, code });
      } catch (err) {
        return json(502, { error: err instanceof Error ? err.message : String(err) });
      }

      let ssoOrg: Organization | null = identity.organizationId ? await store.findOrgBySsoOrgId(identity.organizationId) : null;
      if (identity.organizationId && !ssoOrg) {
        ssoOrg = { id: newOrgId(), name: identity.email.split("@")[1] ?? identity.email, repos: "*", plan: "free", ssoOrgId: identity.organizationId };
        await store.upsertOrg(ssoOrg);
      }

      let ssoTenant = await store.findBySsoUserId(identity.userId);
      if (!ssoTenant) {
        const isFirstInOrg = ssoOrg ? (await store.membersOf(ssoOrg.id)).length === 0 : false;
        ssoTenant = {
          key: newTenantKey(),
          name: identity.email,
          repos: ssoOrg ? ssoOrg.repos : "*",
          ssoUserId: identity.userId,
          ...(ssoOrg ? { orgId: ssoOrg.id, role: (isFirstInOrg ? "owner" : "member") as "owner" | "member" } : { plan: "free" as PlanId }),
        };
        await store.upsert(ssoTenant);
      }

      const headers = new Headers({ location: `${baseUrl}/v1/dashboard` });
      headers.append("set-cookie", buildSessionCookieHeader(await mintSessionTokenWeb(ssoTenant.key, env.WORKOS_API_KEY)));
      headers.append("set-cookie", buildClearStateCookieHeader()); // one round-trip only — dead after use
      return new Response(null, { status: 302, headers });
    }

    // SSO logout — clears the session cookie. Tenant keys aren't revoked (an
    // owner would use /v1/team/remove for that); this only ends the browser
    // session that was standing in for one.
    if (path === "/v1/sso/logout") {
      return new Response(null, { status: 302, headers: { location: `${baseUrl}/pricing`, "set-cookie": buildClearSessionCookieHeader() } });
    }

    // A human visiting an unknown page (typo, stale link) gets a styled 404
    // like the rest of the site, *before* the auth gate below — otherwise an
    // unauthenticated request to a non-existent page would incorrectly come
    // back "401 unauthorized" instead of "404 not found" (tenant auth is
    // always configured on the hosted Worker). API routes (/v1/*) keep their
    // existing auth-first, JSON-404 behavior.
    if (!path.startsWith("/v1/")) {
      return new Response(render404(baseUrl), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ---------- Authenticated routes ----------
    if (req.method !== "GET") return json(405, { error: "method not allowed" });

    let tenant = await store.get(requestKey(req));
    // No API key on the request? An SSO browser session cookie is an equally
    // valid credential — verified with the same WorkOS API key used to sign
    // it, so this only ever applies when SSO is configured.
    if (!tenant && env.WORKOS_API_KEY) {
      const sessionKey = await verifySessionTokenWeb(parseCookie(req.headers.get("cookie"), SESSION_COOKIE), env.WORKOS_API_KEY);
      tenant = await store.get(sessionKey ?? undefined);
    }
    if (!tenant) return json(401, { error: "unauthorized — pass Authorization: Bearer <key>" });
    // A team seat's quota is pooled on the organization, not the individual
    // tenant — every teammate draws from the same daily counter.
    const org = tenant.orgId ? await store.getOrg(tenant.orgId) : null;
    if (!(await meter.consume(tenant, org))) {
      return json(429, { error: "daily quota exceeded", ...(await meter.report(tenant, org)) });
    }

    if (path === "/v1/usage") {
      return json(200, await meter.report(tenant, org));
    }

    // Team: the org owner invites a teammate — mints a key sharing the same
    // org (and so the same pooled quota + plan), shown exactly once.
    if (path === "/v1/team/invite") {
      if (!tenant.orgId || tenant.role !== "owner") {
        return json(403, { error: "only a team owner can invite teammates" });
      }
      const name = url.searchParams.get("name");
      if (!name) return json(400, { error: "usage: /v1/team/invite?name=<teammate>" });
      const memberKey = newTenantKey();
      await store.upsert({ key: memberKey, name, repos: org!.repos, orgId: org!.id, role: "member" });
      return json(200, { ok: true, key: memberKey, name, org: org!.name });
    }

    // Team: the org owner removes a teammate. Cannot remove yourself — that
    // would leave the org billing-less; transfer ownership first if needed.
    if (path === "/v1/team/remove") {
      if (!tenant.orgId || tenant.role !== "owner") {
        return json(403, { error: "only a team owner can remove teammates" });
      }
      const targetKey = url.searchParams.get("key");
      if (!targetKey) return json(400, { error: "usage: /v1/team/remove?key=<teammate-key>" });
      if (targetKey === tenant.key) return json(400, { error: "the owner cannot remove themselves" });
      const target = await store.get(targetKey);
      if (!target || target.orgId !== tenant.orgId) return json(404, { error: "no such teammate in your organization" });
      await store.remove(targetKey);
      return json(200, { ok: true, removed: targetKey });
    }

    if (path === "/v1/dashboard" || path === "/v1/dashboard/data") {
      const reportFor = async (t: typeof tenant) => meter.report(t, t.orgId ? await store.getOrg(t.orgId) : null);
      // Three tiers, most-privileged first: an explicitly-flagged admin sees
      // every tenant platform-wide (never inferred from repo scope); a team
      // owner sees their own org's roster, not other customers'; everyone
      // else sees only themselves.
      const visibleTenants = tenant.admin
        ? await Promise.all((await store.list()).map(async (t) => summarizeTenant(t, (await reportFor(t)).requests)))
        : tenant.orgId && tenant.role === "owner"
        ? await Promise.all((await store.membersOf(tenant.orgId)).map(async (t) => summarizeTenant(t, (await reportFor(t)).requests)))
        : [summarizeTenant(tenant, (await reportFor(tenant)).requests)];
      const data: DashboardData = { service: "mindset-ctx", repos: [], tenants: visibleTenants };
      if (path === "/v1/dashboard/data") return json(200, data);
      return html(200, renderDashboard(data));
    }

    return json(404, {
      error: "not found",
      routes: [
        "/pricing", "/blog", "/blog/:slug", "/v1/health", "/v1/signup?plan=", "/v1/signup/success", "/v1/stripe/webhook",
        "/v1/app/manifest", "/v1/app/webhook", "/v1/app/installed?installation_id=",
        "/v1/sso/login", "/v1/sso/callback", "/v1/sso/logout",
        "/v1/usage", "/v1/dashboard", "/v1/team/invite?name=", "/v1/team/remove?key=",
      ],
    });
  },
};
