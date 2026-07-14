import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { analyzeRepo } from "./analyzer.js";
import { generateAll, mergePreservingManual } from "./generators.js";
import { indexCommits, loadMemory, mergeRecords, searchMemory, writeMemory } from "./memory.js";
import { semanticSearch } from "./embeddings.js";
import { hybridSearch } from "./hybrid.js";
import { TenantStore, UsageMeter, tenantMayAccess, type Tenant } from "./tenants.js";
import { resolveSubscriptionEvent, verifyStripeSignature, type PlanId } from "./billing.js";
import { buildAppManifest, classifyAppEvent, type AppInstallationEvent } from "./githubapp.js";
import { renderDashboard, summarizeRecords, summarizeTenant, type DashboardData } from "./dashboard.js";
import { createCheckoutSession, newTenantKey, priceForPlan } from "./checkout.js";
import { PLANS } from "./billing.js";
import { renderAppInstalled, renderPricing, renderSuccess } from "./pricing.js";

/**
 * Context API so AI tools (Claude Code, Cursor, …) can pull always-fresh
 * context over HTTP. Serves one or many repos from a single process — the
 * hosted multi-repo/multi-tenant mode.
 *
 *   GET  /v1/health                             — liveness (never requires auth)
 *   GET  /v1/repos                              — registered repos
 *   GET  /v1/usage                              — calling tenant's quota usage (tenants mode)
 *   GET  /v1/repos/:repo/analysis               — structured repo analysis (JSON)
 *   GET  /v1/repos/:repo/context/:name          — a context file (claude, agents, …)
 *   GET  /v1/dashboard                          — HTML ops dashboard (repos, tenants, quotas)
 *   GET  /v1/dashboard/data                      — the same as JSON
 *   GET  /v1/repos/:repo/memory/search?q=&mode= — memory search. mode=lexical (BM25,
 *                                                 default) | semantic (Voyage embeddings)
 *                                                 | hybrid (RRF fusion of both). semantic
 *                                                 and hybrid need `ctx index --embed`.
 *   POST /v1/repos/:repo/webhook                — GitHub or GitLab webhook (push/issues/PR):
 *                                                 verifies X-Hub-Signature-256 (GitHub) or
 *                                                 X-Gitlab-Token (GitLab); refreshes memory
 *                                                 + context files
 *   GET  /v1/app/manifest                       — GitHub App manifest (one-click create)
 *   POST /v1/app/webhook                         — GitHub App events (installation…):
 *                                                 HMAC-verified; classified for the log
 *   POST /v1/stripe/webhook                      — Stripe subscription events: verifies
 *                                                 the signature and flips a tenant's plan
 *
 * When exactly one repo is registered, the unprefixed shortcuts keep working.
 *
 * Auth:
 *  - { apiKey }: single shared key on every route except /v1/health (Bearer
 *    or x-api-key). Webhook routes authenticate via their own signatures.
 *  - { tenants } / { tenantStore }: per-tenant keys with repo scopes and
 *    plan-based quotas — the hosted micro-SaaS (metering via /v1/usage,
 *    billing via Stripe).
 */

export interface ServerOptions {
  apiKey?: string;
  /** Plain tenant list (wrapped in a non-persistent store internally). */
  tenants?: Tenant[];
  /** Mutable, optionally file-backed tenant store (takes precedence). */
  tenantStore?: TenantStore;
  /** Shared secret for GitHub webhook + App signature verification. */
  webhookSecret?: string;
  /** Stripe endpoint signing secret; enables POST /v1/stripe/webhook. */
  stripeSecret?: string;
  /** Stripe Price ID → plan id map (from STRIPE_PRICE_MAP). */
  stripePriceMap?: Record<string, PlanId>;
  /** Stripe secret key (sk_...); enables POST /v1/checkout. */
  stripeApiKey?: string;
  /** Override Stripe API base (for tests). Default: https://api.stripe.com */
  stripeBaseURL?: string;
  /** Where Stripe returns the buyer after checkout. */
  checkoutSuccessUrl?: string;
  checkoutCancelUrl?: string;
  /** Public base URL, used to build the GitHub App manifest. */
  appBaseUrl?: string;
}

export const CONTEXT_FILES: Record<string, string> = {
  "claude": "CLAUDE.md",
  "agents": "AGENTS.md",
  "architecture": "docs/ARCHITECTURE.md",
  "contributing": "CONTRIBUTING.md",
  "prompts": ".context/prompts.md",
};

const WEBHOOK_EVENTS = new Set(["push", "issues", "pull_request", "discussion", "ping"]);

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/markdown; charset=utf-8" });
  res.end(text);
}

function requestKey(req: IncomingMessage): string | undefined {
  const bearer = req.headers.authorization;
  if (bearer?.startsWith("Bearer ")) return bearer.slice("Bearer ".length);
  const header = req.headers["x-api-key"];
  return typeof header === "string" ? header : undefined;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function validSignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
}

/**
 * GitLab webhooks authenticate with a static shared token in X-Gitlab-Token
 * (compared directly, unlike GitHub's HMAC-signed body) — constant-time to
 * avoid timing side-channels.
 */
function validGitLabToken(secret: string, header: string | undefined): boolean {
  if (!header || header.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(header, "utf8"), Buffer.from(secret, "utf8"));
}

/** GitLab's human-readable X-Gitlab-Event names → our normalized event strings. */
const GITLAB_EVENT_MAP: Record<string, string> = {
  "Push Hook": "push",
  "Issue Hook": "issues",
  "Merge Request Hook": "pull_request",
};

/** Refresh a repo after a webhook event: re-index memory, regenerate context. */
function refreshRepo(root: string, event: string): { memoryRecords: number; regenerated: string[] } {
  const records = mergeRecords(loadMemory(root), indexCommits(root));
  writeMemory(root, records);

  const regenerated: string[] = [];
  if (event === "push") {
    const analysis = analyzeRepo(root);
    for (const file of generateAll(analysis)) {
      const full = join(root, file.path);
      const existing = existsSync(full) ? readFileSync(full, "utf8") : null;
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, mergePreservingManual(file.content, existing));
      regenerated.push(file.path);
    }
  }
  return { memoryRecords: records.length, regenerated };
}

/** Normalize the repos argument: a single root or a name→root map. */
function toRepoMap(rootOrRepos: string | Record<string, string>): Record<string, string> {
  if (typeof rootOrRepos === "string") return { [basename(rootOrRepos) || "repo"]: rootOrRepos };
  return rootOrRepos;
}

async function handleRepoRoute(root: string, sub: string, url: URL, res: ServerResponse): Promise<void> {
  if (sub === "analysis") {
    sendJson(res, 200, analyzeRepo(root));
    return;
  }

  const contextMatch = sub.match(/^context\/([a-z-]+)$/);
  if (contextMatch) {
    const file = CONTEXT_FILES[contextMatch[1]];
    if (!file) {
      sendJson(res, 404, { error: `unknown context '${contextMatch[1]}'`, available: Object.keys(CONTEXT_FILES) });
      return;
    }
    const full = normalize(join(root, file));
    if (!existsSync(full)) {
      sendJson(res, 404, { error: `${file} not generated yet — run \`ctx generate\`` });
      return;
    }
    sendText(res, 200, readFileSync(full, "utf8"));
    return;
  }

  if (sub === "memory/search") {
    const q = url.searchParams.get("q") ?? "";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100);
    const mode = url.searchParams.get("mode") ?? "lexical";
    const records = loadMemory(root);
    try {
      if (mode === "semantic") {
        const results = await semanticSearch(root, records, q, limit);
        sendJson(res, 200, { query: q, mode, total: records.length, results });
      } else if (mode === "hybrid") {
        const results = await hybridSearch(root, records, q, limit);
        sendJson(res, 200, { query: q, mode, total: records.length, results });
      } else {
        sendJson(res, 200, { query: q, mode: "lexical", total: records.length, results: searchMemory(records, q, limit) });
      }
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  sendJson(res, 404, { error: "not found", routes: ["analysis", "context/:name", "memory/search?q=", "webhook (POST)"] });
}

export function createContextServer(rootOrRepos: string | Record<string, string>, opts: ServerOptions = {}) {
  const repos = toRepoMap(rootOrRepos);
  const names = Object.keys(repos);
  const soleName = names.length === 1 ? names[0] : null;
  const store = opts.tenantStore ?? new TenantStore(opts.tenants ?? []);
  const tenantsEnabled = store.all().length > 0;
  const priceMap = opts.stripePriceMap ?? {};
  const meter = new UsageMeter();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/v1/health" || path === "/") {
      sendJson(res, 200, { ok: true, service: "mindset-ctx", repos: names });
      return;
    }

    // Public marketing pages — no auth required.
    if (path === "/pricing" || path === "/") {
      const availablePlans = new Set<PlanId>(Object.values(priceMap));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderPricing({ baseUrl: opts.appBaseUrl ?? "", availablePlans }));
      return;
    }

    // Self-service signup: mint a tenant key, register it as free, and
    // create a Stripe Checkout session. No pre-existing account required —
    // this is the fully-automated payment funnel.
    if (path === "/v1/signup") {
      if (!opts.stripeApiKey) {
        sendJson(res, 503, { error: "signup not configured — set --stripe-api-key" });
        return;
      }
      const plan = (url.searchParams.get("plan") ?? "pro") as PlanId;
      if (!PLANS[plan] || plan === "free") {
        sendJson(res, 400, { error: `plan '${plan}' cannot be purchased`, plans: Object.keys(PLANS).filter((p) => p !== "free") });
        return;
      }
      const priceId = priceForPlan(plan, priceMap);
      if (!priceId) {
        sendJson(res, 400, { error: `no Stripe price mapped for plan '${plan}'` });
        return;
      }
      // Mint a fresh tenant key and add it as a free tenant. The webhook flips
      // it to the paid plan once the subscription is created.
      const tenantKey = newTenantKey();
      store.upsert({ key: tenantKey, name: `signup-${tenantKey.slice(-8)}`, repos: "*", plan: "free" });
      const base = opts.appBaseUrl ?? `http://${req.headers.host ?? "localhost"}`;
      try {
        const session = await createCheckoutSession({
          secretKey: opts.stripeApiKey,
          priceId,
          tenantKey,
          successUrl: `${base}/v1/signup/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${base}/pricing`,
          baseURL: opts.stripeBaseURL,
        });
        res.writeHead(302, { location: session.url });
        res.end();
      } catch (err) {
        sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // Stripe redirects here after successful payment. Look up the checkout
    // session to recover the tenant key we stamped into client_reference_id,
    // and show it to the buyer exactly once.
    if (path === "/v1/signup/success") {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId || !opts.stripeApiKey) {
        sendJson(res, 400, { error: "missing session_id" });
        return;
      }
      try {
        const stripeBase = (opts.stripeBaseURL ?? "https://api.stripe.com").replace(/\/+$/, "");
        const lookup = await fetch(`${stripeBase}/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
          headers: { authorization: `Bearer ${opts.stripeApiKey}` },
        });
        if (!lookup.ok) {
          sendJson(res, 502, { error: `stripe lookup ${lookup.status}` });
          return;
        }
        const data = (await lookup.json()) as { client_reference_id?: string };
        const tenantKey = data.client_reference_id ?? "(clé introuvable — contactez le support)";
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderSuccess(tenantKey));
      } catch (err) {
        sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // GitHub App manifest — public, for one-click App creation.
    if (path === "/v1/app/manifest") {
      const base = opts.appBaseUrl ?? `http://${req.headers.host ?? "localhost"}`;
      sendJson(res, 200, buildAppManifest(base));
      return;
    }

    // GitHub App lifecycle webhook (installation / installation_repositories).
    if (path === "/v1/app/webhook") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "app webhook expects POST" });
        return;
      }
      if (!opts.webhookSecret) {
        sendJson(res, 503, { error: "webhook secret not configured" });
        return;
      }
      const body = await readBody(req);
      if (!validSignature(opts.webhookSecret, body, req.headers["x-hub-signature-256"] as string | undefined)) {
        sendJson(res, 401, { error: "invalid webhook signature" });
        return;
      }
      const event = String(req.headers["x-github-event"] ?? "unknown");
      if (event === "ping") {
        sendJson(res, 200, { ok: true, event, action: "pong" });
        return;
      }
      let payload: AppInstallationEvent;
      try {
        payload = JSON.parse(body.toString("utf8")) as AppInstallationEvent;
      } catch {
        sendJson(res, 400, { error: "invalid JSON payload" });
        return;
      }
      const outcome = classifyAppEvent(event, payload);
      // Provision (or deprovision) a tenant from the installation lifecycle —
      // this is the App-install equivalent of /v1/signup: no pre-existing
      // account needed, the install itself grants a scoped API key.
      if (outcome.kind === "installed") {
        const existing = store.findByInstallationId(outcome.installationId);
        if (!existing) {
          store.upsert({
            key: newTenantKey(),
            name: outcome.account,
            repos: outcome.repos.length ? outcome.repos : "*",
            plan: "free",
            installationId: outcome.installationId,
          });
        }
      } else if (outcome.kind === "uninstalled") {
        const tenant = store.findByInstallationId(outcome.installationId);
        if (tenant) store.remove(tenant.key);
      } else if (outcome.kind === "repos-added" || outcome.kind === "repos-removed") {
        const tenant = store.findByInstallationId(outcome.installationId);
        if (tenant && tenant.repos !== "*") {
          const scoped = new Set(tenant.repos);
          for (const r of outcome.repos) {
            if (outcome.kind === "repos-added") scoped.add(r);
            else scoped.delete(r);
          }
          store.upsert({ ...tenant, repos: [...scoped] });
        }
      }
      sendJson(res, 200, { ok: true, event, outcome });
      return;
    }

    // Browser lands here right after installing the GitHub App (the
    // manifest's redirect_url). The webhook above usually arrives first and
    // already minted the tenant; look it up by installation id and hand over
    // the key exactly once, mirroring the Stripe /v1/signup/success page.
    if (path === "/v1/app/installed") {
      const rawInstallationId = url.searchParams.get("installation_id") ?? "";
      const installationId = Number(rawInstallationId);
      const tenant = installationId ? store.findByInstallationId(installationId) : null;
      const refreshHref = `${path}?${new URLSearchParams({ installation_id: rawInstallationId }).toString()}`;
      res.writeHead(tenant ? 200 : 202, { "content-type": "text/html; charset=utf-8" });
      res.end(
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
      return;
    }

    // Stripe subscription webhook — flips a tenant's plan on billing changes.
    if (path === "/v1/stripe/webhook") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "stripe webhook expects POST" });
        return;
      }
      if (!opts.stripeSecret) {
        sendJson(res, 503, { error: "stripe secret not configured — set --stripe-secret or CTX_STRIPE_SECRET" });
        return;
      }
      const body = await readBody(req);
      const raw = body.toString("utf8");
      if (!verifyStripeSignature(raw, req.headers["stripe-signature"] as string | undefined, opts.stripeSecret)) {
        sendJson(res, 400, { error: "invalid stripe signature" });
        return;
      }
      let event;
      try {
        event = JSON.parse(raw) as Parameters<typeof resolveSubscriptionEvent>[0];
      } catch {
        sendJson(res, 400, { error: "invalid JSON payload" });
        return;
      }
      const outcome = resolveSubscriptionEvent(event, priceMap);
      if (outcome.action === "set-plan" || outcome.action === "downgrade") {
        const applied = store.setPlan(outcome.tenantKey, outcome.plan);
        sendJson(res, 200, { ok: true, ...outcome, applied });
      } else {
        sendJson(res, 200, { ok: true, ...outcome });
      }
      return;
    }

    // Webhooks authenticate via HMAC signature, not API key.
    const webhookMatch = path.match(/^\/v1\/repos\/([^/]+)\/webhook$/) ?? (soleName && path === "/v1/webhook" ? [path, soleName] : null);
    if (webhookMatch) {
      const repoName = decodeURIComponent(webhookMatch[1]);
      const root = repos[repoName];
      if (!root) {
        sendJson(res, 404, { error: `unknown repo '${repoName}'`, repos: names });
        return;
      }
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "webhook expects POST" });
        return;
      }
      if (!opts.webhookSecret) {
        sendJson(res, 503, { error: "webhook secret not configured — start with --webhook-secret or CTX_WEBHOOK_SECRET" });
        return;
      }
      const body = await readBody(req);
      // Provider is inferred from which header it actually sent — GitHub
      // signs the body (X-Hub-Signature-256), GitLab sends a plain shared
      // token (X-Gitlab-Token). Same repo, either provider, one endpoint.
      const gitlabToken = req.headers["x-gitlab-token"] as string | undefined;
      let event: string;
      if (gitlabToken !== undefined) {
        if (!validGitLabToken(opts.webhookSecret, gitlabToken)) {
          sendJson(res, 401, { error: "invalid webhook token" });
          return;
        }
        const gitlabEvent = String(req.headers["x-gitlab-event"] ?? "unknown");
        event = GITLAB_EVENT_MAP[gitlabEvent] ?? gitlabEvent;
      } else {
        if (!validSignature(opts.webhookSecret, body, req.headers["x-hub-signature-256"] as string | undefined)) {
          sendJson(res, 401, { error: "invalid webhook signature" });
          return;
        }
        event = String(req.headers["x-github-event"] ?? "unknown");
      }
      if (!WEBHOOK_EVENTS.has(event)) {
        sendJson(res, 200, { ok: true, event, action: "ignored" });
        return;
      }
      if (event === "ping") {
        sendJson(res, 200, { ok: true, event, action: "pong" });
        return;
      }
      const result = refreshRepo(root, event);
      sendJson(res, 200, { ok: true, event, ...result });
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }

    // Authentication + authorization.
    let tenant: Tenant | null = null;
    if (tenantsEnabled) {
      tenant = store.get(requestKey(req));
      if (!tenant) {
        sendJson(res, 401, { error: "unauthorized — pass a tenant key via Authorization: Bearer <key> or x-api-key" });
        return;
      }
      if (!meter.consume(tenant)) {
        sendJson(res, 429, { error: "daily quota exceeded", ...meter.report(tenant) });
        return;
      }
    } else if (opts.apiKey && requestKey(req) !== opts.apiKey) {
      sendJson(res, 401, { error: "unauthorized — pass Authorization: Bearer <key> or x-api-key" });
      return;
    }

    if (path === "/v1/usage") {
      if (!tenant) {
        sendJson(res, 404, { error: "usage metering is only available in tenants mode (--tenants)" });
        return;
      }
      sendJson(res, 200, meter.report(tenant));
      return;
    }

    // Checkout: the calling tenant requests an upgrade → Stripe payment URL.
    if (path === "/v1/checkout") {
      if (!tenant) {
        sendJson(res, 404, { error: "checkout is only available in tenants mode (--tenants)" });
        return;
      }
      if (!opts.stripeApiKey) {
        sendJson(res, 503, { error: "checkout not configured — set --stripe-api-key or CTX_STRIPE_API_KEY" });
        return;
      }
      const plan = (url.searchParams.get("plan") ?? "pro") as PlanId;
      if (!PLANS[plan]) {
        sendJson(res, 400, { error: `unknown plan '${plan}'`, plans: Object.keys(PLANS) });
        return;
      }
      const priceId = priceForPlan(plan, priceMap);
      if (!priceId) {
        sendJson(res, 400, { error: `no Stripe price mapped for plan '${plan}' (free plan needs no checkout)` });
        return;
      }
      try {
        const session = await createCheckoutSession({
          secretKey: opts.stripeApiKey,
          priceId,
          tenantKey: tenant.key,
          successUrl: opts.checkoutSuccessUrl ?? `${opts.appBaseUrl ?? ""}/v1/dashboard`,
          cancelUrl: opts.checkoutCancelUrl ?? `${opts.appBaseUrl ?? ""}/v1/dashboard`,
          baseURL: opts.stripeBaseURL,
        });
        sendJson(res, 200, { plan, checkoutUrl: session.url, sessionId: session.id });
      } catch (err) {
        sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // Dashboard: HTML shell at /v1/dashboard, JSON at /v1/dashboard/data.
    // Scoped to the repos/tenants the caller may see.
    if (path === "/v1/dashboard" || path === "/v1/dashboard/data") {
      const visibleRepos = (tenant ? names.filter((n) => tenantMayAccess(tenant, n)) : names).map((name) =>
        summarizeRecords(name, loadMemory(repos[name])),
      );
      // Only an explicitly-flagged admin tenant sees every tenant. Customer
      // tenants are often "*"-scoped too (self-service signup, App installs
      // covering all repos), so repo scope must never grant the operator
      // view. Keyless (shared-key) mode still sees all — it IS the operator.
      const visibleTenants =
        tenant && !tenant.admin
          ? [summarizeTenant(tenant, meter.report(tenant).requests)]
          : store.all().map((t) => summarizeTenant(t, meter.report(t).requests));
      const data: DashboardData = { service: "mindset-ctx", repos: visibleRepos, tenants: visibleTenants };
      if (path === "/v1/dashboard/data") {
        sendJson(res, 200, data);
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderDashboard(data));
      }
      return;
    }

    if (path === "/v1/repos") {
      const visible = tenant ? names.filter((n) => tenantMayAccess(tenant, n)) : names;
      sendJson(res, 200, { repos: visible.map((name) => ({ name, root: repos[name] })) });
      return;
    }

    const repoMatch = path.match(/^\/v1\/repos\/([^/]+)\/(.+)$/);
    if (repoMatch) {
      const repoName = decodeURIComponent(repoMatch[1]);
      const root = repos[repoName];
      if (!root) {
        sendJson(res, 404, { error: `unknown repo '${repoName}'`, repos: names });
        return;
      }
      if (tenant && !tenantMayAccess(tenant, repoName)) {
        sendJson(res, 403, { error: `tenant '${tenant.name}' has no access to repo '${repoName}'` });
        return;
      }
      await handleRepoRoute(root, repoMatch[2], url, res);
      return;
    }

    // Single-repo shortcuts, kept for zero-config local use.
    if (soleName && path.startsWith("/v1/")) {
      if (tenant && !tenantMayAccess(tenant, soleName)) {
        sendJson(res, 403, { error: `tenant '${tenant.name}' has no access to repo '${soleName}'` });
        return;
      }
      await handleRepoRoute(repos[soleName], path.slice("/v1/".length), url, res);
      return;
    }

    sendJson(res, 404, {
      error: "not found",
      routes: [
        "/v1/health", "/v1/repos", "/v1/usage", "/v1/dashboard",
        "/v1/repos/:repo/analysis", "/v1/repos/:repo/context/:name",
        "/v1/repos/:repo/memory/search?q=&mode=hybrid", "POST /v1/repos/:repo/webhook",
      ],
    });
  }

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });
}
