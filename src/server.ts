import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { analyzeRepo } from "./analyzer.js";
import { generateAll, mergePreservingManual } from "./generators.js";
import { indexCommits, loadMemory, mergeRecords, searchMemory, writeMemory } from "./memory.js";
import { semanticSearch } from "./embeddings.js";
import { hybridSearch } from "./hybrid.js";
import { getMlReranker, mlRerank } from "./rank-ml.js";
import { TenantStore, UsageMeter, tenantCanManageBilling, tenantMayAccess, type Organization, type Tenant } from "./tenants.js";
import { resolveSubscriptionEvent, verifyStripeSignature, type PlanId } from "./billing.js";
import { buildAppManifest, classifyAppEvent, type AppInstallationEvent } from "./githubapp.js";
import { renderDashboard, summarizeRecords, summarizeTenant, type DashboardData } from "./dashboard.js";
import { createCheckoutSession, newOrgId, newTenantKey, priceForPlan } from "./checkout.js";
import { PLANS } from "./billing.js";
import { renderAppInstalled, renderPricing, renderSuccess } from "./pricing.js";
import { renderHome, renderDocs, render404 } from "./home.js";
import { renderBlogIndex, renderBlogPost } from "./blog.js";
import { ogImageBytes } from "./og-image.js";
import { FAVICON_SVG } from "./favicon.js";
import { renderRobotsTxt, renderSitemapXml } from "./seo.js";
import { buildWorkosAuthorizationUrl, exchangeWorkosCode } from "./workos.js";
import {
  buildClearSessionCookieHeader, buildClearStateCookieHeader, buildSessionCookieHeader, buildStateCookieHeader,
  newOauthState, parseCookie, OAUTH_STATE_COOKIE, SESSION_COOKIE, SESSION_TTL_SEC,
} from "./session.js";

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
  /** WorkOS client id; enables GET /v1/sso/login and /v1/sso/callback. */
  workosClientId?: string;
  /** WorkOS API key (secret) — exchanges the login callback's code for the user's identity. */
  workosApiKey?: string;
  /** Override WorkOS API base (for tests). Default: https://api.workos.com */
  workosBaseURL?: string;
  /**
   * Local directory holding a Rank ML cross-encoder exported by
   * notebooks/train_rank_ml.py (ONNX + tokenizer files). Node-only — see
   * rank-ml.ts for why. Unset or missing directory: falls back to Rank v0.
   */
  rankMlModelDir?: string;
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
 * Sign/verify a browser session cookie for SSO logins — see session.ts for
 * the token shape and cookie plumbing shared with the Worker. Signed with
 * the WorkOS API key: it's already a secret only the server holds, so this
 * avoids introducing a dedicated session-signing secret just for cookies.
 */
function mintSessionToken(tenantKey: string, secret: string, now = Date.now()): string {
  const expiry = Math.floor(now / 1000) + SESSION_TTL_SEC;
  const sig = createHmac("sha256", secret).update(`${tenantKey}.${expiry}`).digest("hex");
  return `${tenantKey}.${expiry}.${sig}`;
}

function verifySessionToken(token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [key, expiryStr, sig] = parts;
  const expiry = Number(expiryStr);
  if (!expiry || Math.floor(Date.now() / 1000) > expiry) return null;
  const expected = createHmac("sha256", secret).update(`${key}.${expiry}`).digest("hex");
  if (sig.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8")) ? key : null;
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

async function handleRepoRoute(root: string, sub: string, url: URL, res: ServerResponse, mlModelDir?: string): Promise<void> {
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
        let results = await hybridSearch(root, records, q, limit);
        // Rank ML (Node-only, see rank-ml.ts): re-blends the top results with
        // a real cross-encoder if one has been trained and pointed at via
        // CTX_RANK_ML_MODEL_DIR. Falls back to plain Rank v0 (the
        // hybridSearch result above) on any load or inference failure.
        const reranker = await getMlReranker(mlModelDir);
        if (reranker) {
          try {
            results = await mlRerank(results, q, reranker);
          } catch (err) {
            console.error("rank-ml: rerank failed — serving Rank v0 order:", err instanceof Error ? err.message : err);
          }
        }
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
  // Whether tenant-based auth is active at all — decided by whether the
  // caller opted in (passed a store or a tenants list), NOT by whether the
  // store currently happens to hold any tenants. The old `store.all().length
  // > 0` check froze this at construction time: a store that legitimately
  // starts empty (self-service signup growing it later, or an owner using
  // /v1/team/invite) would never again recognize ANY tenant as authenticated,
  // since this was only ever evaluated once.
  const tenantsEnabled = opts.tenantStore !== undefined || opts.tenants !== undefined;
  const priceMap = opts.stripePriceMap ?? {};
  const meter = new UsageMeter();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/v1/health") {
      sendJson(res, 200, { ok: true, service: "mindset-ctx", repos: names });
      return;
    }

    // Public marketing pages — no auth required. Root domain is the vitrine
    // (thesis, not price list); "/" previously aliased to the health check
    // above and this branch was dead code — fixed while adding /docs.
    if (path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderHome(opts.appBaseUrl));
      return;
    }

    if (path === "/docs") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderDocs(opts.appBaseUrl));
      return;
    }

    if (path === "/pricing") {
      const availablePlans = new Set<PlanId>(Object.values(priceMap));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderPricing({ baseUrl: opts.appBaseUrl ?? "", availablePlans }));
      return;
    }

    // Open Graph / Twitter Card preview image — same bytes on both runtimes,
    // embedded in og-image.ts rather than hosted separately (see there for why).
    if (path === "/og-image.png") {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
      res.end(Buffer.from(ogImageBytes()));
      return;
    }

    if (path === "/favicon.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" });
      res.end(FAVICON_SVG);
      return;
    }

    // Browsers request this by default even with a <link rel="icon"> pointing
    // elsewhere — redirect rather than let it fall through to a 404.
    if (path === "/favicon.ico") {
      res.writeHead(302, { location: "/favicon.svg" });
      res.end();
      return;
    }

    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(renderRobotsTxt(opts.appBaseUrl));
      return;
    }

    if (path === "/sitemap.xml") {
      const base = opts.appBaseUrl ?? `http://${req.headers.host ?? "localhost"}`;
      res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
      res.end(renderSitemapXml(base));
      return;
    }

    if (path === "/blog") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderBlogIndex(opts.appBaseUrl));
      return;
    }

    const blogMatch = path.match(/^\/blog\/([a-z0-9-]+)$/);
    if (blogMatch) {
      const rendered = renderBlogPost(blogMatch[1], opts.appBaseUrl);
      if (!rendered) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end(render404(opts.appBaseUrl));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(rendered);
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
      // Team is multi-seat by definition — the signing-up tenant becomes the
      // org's owner (able to invite teammates and manage billing) rather than
      // a standalone tenant with its own plan. Pro stays a plain solo tenant.
      if (plan === "team") {
        const orgId = newOrgId();
        store.upsertOrg({ id: orgId, name: `team-${orgId.slice(-8)}`, repos: "*", plan: "free" });
        store.upsert({ key: tenantKey, name: `signup-${tenantKey.slice(-8)}`, repos: "*", orgId, role: "owner" });
      } else {
        store.upsert({ key: tenantKey, name: `signup-${tenantKey.slice(-8)}`, repos: "*", plan: "free" });
      }
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

    // SSO login (WorkOS AuthKit) — sends the browser to WorkOS's hosted login.
    // Optional ?org=<workos_organization_id> scopes it to one company's SSO
    // connection; omitted, WorkOS shows its general AuthKit login screen.
    if (path === "/v1/sso/login") {
      if (!opts.workosClientId) {
        sendJson(res, 503, { error: "SSO not configured — set --workos-client-id or WORKOS_CLIENT_ID" });
        return;
      }
      const base = opts.appBaseUrl ?? `http://${req.headers.host ?? "localhost"}`;
      // OAuth state: a fresh nonce, echoed back by WorkOS and checked at the
      // callback against this cookie — blocks login-CSRF (an attacker forcing
      // a victim's browser through the callback with the attacker's code).
      const state = newOauthState();
      const authUrl = buildWorkosAuthorizationUrl({
        clientId: opts.workosClientId,
        redirectUri: `${base.replace(/\/+$/, "")}/v1/sso/callback`,
        organizationId: url.searchParams.get("org") ?? undefined,
        state,
        baseURL: opts.workosBaseURL,
      });
      res.writeHead(302, { location: authUrl, "set-cookie": buildStateCookieHeader(state) });
      res.end();
      return;
    }

    // SSO callback — exchanges WorkOS's one-time code for the user's identity,
    // auto-provisions an org (first login for a company) and/or a tenant seat
    // (first login for that person), then sets a signed session cookie. This
    // is the SSO equivalent of /v1/signup and /v1/app/webhook: no pre-existing
    // account needed, the identity provider login itself grants access.
    if (path === "/v1/sso/callback") {
      if (!opts.workosClientId || !opts.workosApiKey) {
        sendJson(res, 503, { error: "SSO not configured" });
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        sendJson(res, 400, { error: "missing code" });
        return;
      }
      // The state echoed by WorkOS must match the nonce we set at login —
      // otherwise this callback wasn't started by this browser. Reject it.
      const returnedState = url.searchParams.get("state") ?? "";
      const cookieState = parseCookie(req.headers.cookie, OAUTH_STATE_COOKIE) ?? "";
      const stateOk =
        returnedState.length > 0 &&
        returnedState.length === cookieState.length &&
        timingSafeEqual(Buffer.from(returnedState, "utf8"), Buffer.from(cookieState, "utf8"));
      if (!stateOk) {
        sendJson(res, 403, { error: "state mismatch — restart the login from /v1/sso/login" });
        return;
      }
      let identity;
      try {
        identity = await exchangeWorkosCode({
          clientId: opts.workosClientId,
          apiKey: opts.workosApiKey,
          code,
          baseURL: opts.workosBaseURL,
        });
      } catch (err) {
        sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) });
        return;
      }

      let org: Organization | null = identity.organizationId ? store.findOrgBySsoOrgId(identity.organizationId) : null;
      if (identity.organizationId && !org) {
        org = { id: newOrgId(), name: identity.email.split("@")[1] ?? identity.email, repos: "*", plan: "free", ssoOrgId: identity.organizationId };
        store.upsertOrg(org);
      }

      let tenant = store.findBySsoUserId(identity.userId);
      if (!tenant) {
        const isFirstInOrg = org ? store.membersOf(org.id).length === 0 : false;
        tenant = {
          key: newTenantKey(),
          name: identity.email,
          repos: org ? org.repos : "*",
          ssoUserId: identity.userId,
          ...(org ? { orgId: org.id, role: (isFirstInOrg ? "owner" : "member") as "owner" | "member" } : { plan: "free" as PlanId }),
        };
        store.upsert(tenant);
      }

      res.writeHead(302, {
        location: `${opts.appBaseUrl ?? ""}/v1/dashboard`,
        "set-cookie": [
          buildSessionCookieHeader(mintSessionToken(tenant.key, opts.workosApiKey)),
          buildClearStateCookieHeader(), // one round-trip only — dead after use
        ],
      });
      res.end();
      return;
    }

    // SSO logout — clears the session cookie. Tenant keys aren't revoked (an
    // owner would use /v1/team/remove for that); this only ends the browser
    // session that was standing in for one.
    if (path === "/v1/sso/logout") {
      res.writeHead(302, { location: `${opts.appBaseUrl ?? ""}/pricing`, "set-cookie": buildClearSessionCookieHeader() });
      res.end();
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
        // A team's billing lives on the organization, not the individual
        // tenant who happened to check out — every teammate shares it.
        const billedTenant = store.get(outcome.tenantKey);
        const applied = billedTenant?.orgId
          ? store.setOrgPlan(billedTenant.orgId, outcome.plan)
          : store.setPlan(outcome.tenantKey, outcome.plan);
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

    // A human visiting an unknown page (typo, stale link) gets a styled 404
    // like the rest of the site, *before* the auth gate below — otherwise an
    // unauthenticated request to a non-existent page would incorrectly come
    // back "401 unauthorized" instead of "404 not found" whenever tenant
    // auth is configured (the always-on case for the hosted Worker). API
    // routes (/v1/*) keep their existing auth-first, JSON-404 behavior.
    if (!path.startsWith("/v1/")) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(render404(opts.appBaseUrl));
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }

    // Authentication + authorization.
    let tenant: Tenant | null = null;
    let org: Organization | null = null;
    if (tenantsEnabled) {
      tenant = store.get(requestKey(req));
      // No API key on the request? An SSO browser session cookie is an
      // equally valid credential — verified with the same WorkOS API key
      // used to sign it, so this only ever applies when SSO is configured.
      if (!tenant && opts.workosApiKey) {
        const sessionKey = verifySessionToken(parseCookie(req.headers.cookie, SESSION_COOKIE), opts.workosApiKey);
        tenant = store.get(sessionKey ?? undefined);
      }
      if (!tenant) {
        sendJson(res, 401, { error: "unauthorized — pass a tenant key via Authorization: Bearer <key> or x-api-key" });
        return;
      }
      // A team seat's quota is pooled on the organization, not the individual
      // tenant — every teammate draws from the same daily counter.
      org = tenant.orgId ? store.getOrg(tenant.orgId) : null;
      if (!meter.consume(tenant, org)) {
        sendJson(res, 429, { error: "daily quota exceeded", ...meter.report(tenant, org) });
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
      sendJson(res, 200, meter.report(tenant, org));
      return;
    }

    // Checkout: the calling tenant requests an upgrade → Stripe payment URL.
    // Team seats: only the owner may change billing — a plan change affects
    // every teammate's shared quota, not just the caller's.
    if (path === "/v1/checkout") {
      if (!tenant) {
        sendJson(res, 404, { error: "checkout is only available in tenants mode (--tenants)" });
        return;
      }
      if (!tenantCanManageBilling(tenant)) {
        sendJson(res, 403, { error: "only the team owner can change billing" });
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

    // Team: the org owner invites a teammate — mints a key sharing the same
    // org (and so the same pooled quota + plan), shown exactly once.
    if (path === "/v1/team/invite") {
      if (!tenant) {
        sendJson(res, 404, { error: "team invites are only available in tenants mode (--tenants)" });
        return;
      }
      if (!tenant.orgId || tenant.role !== "owner") {
        sendJson(res, 403, { error: "only a team owner can invite teammates" });
        return;
      }
      const name = url.searchParams.get("name");
      if (!name) {
        sendJson(res, 400, { error: "usage: /v1/team/invite?name=<teammate>" });
        return;
      }
      const org = store.getOrg(tenant.orgId)!;
      const key = newTenantKey();
      store.upsert({ key, name, repos: org.repos, orgId: org.id, role: "member" });
      sendJson(res, 200, { ok: true, key, name, org: org.name });
      return;
    }

    // Team: the org owner removes a teammate. Cannot remove yourself — that
    // would leave the org billing-less; transfer ownership first if needed.
    if (path === "/v1/team/remove") {
      if (!tenant) {
        sendJson(res, 404, { error: "team management is only available in tenants mode (--tenants)" });
        return;
      }
      if (!tenant.orgId || tenant.role !== "owner") {
        sendJson(res, 403, { error: "only a team owner can remove teammates" });
        return;
      }
      const targetKey = url.searchParams.get("key");
      if (!targetKey) {
        sendJson(res, 400, { error: "usage: /v1/team/remove?key=<teammate-key>" });
        return;
      }
      if (targetKey === tenant.key) {
        sendJson(res, 400, { error: "the owner cannot remove themselves" });
        return;
      }
      const target = store.get(targetKey);
      if (!target || target.orgId !== tenant.orgId) {
        sendJson(res, 404, { error: "no such teammate in your organization" });
        return;
      }
      store.remove(targetKey);
      sendJson(res, 200, { ok: true, removed: targetKey });
      return;
    }

    // Dashboard: HTML shell at /v1/dashboard, JSON at /v1/dashboard/data.
    // Scoped to the repos/tenants the caller may see.
    if (path === "/v1/dashboard" || path === "/v1/dashboard/data") {
      const visibleRepos = (tenant ? names.filter((n) => tenantMayAccess(tenant, n)) : names).map((name) =>
        summarizeRecords(name, loadMemory(repos[name])),
      );
      const reportFor = (t: Tenant) => meter.report(t, t.orgId ? store.getOrg(t.orgId) : null);
      // Three tiers, most-privileged first: an explicitly-flagged admin sees
      // every tenant platform-wide (never inferred from repo scope — customer
      // tenants are often "*"-scoped too); a team owner sees their own org's
      // roster, not other customers'; everyone else sees only themselves.
      // Keyless (shared-key) mode has no tenant at all — the caller IS the operator.
      const visibleTenants = !tenant
        ? store.all().map((t) => summarizeTenant(t, reportFor(t).requests))
        : tenant.admin
        ? store.all().map((t) => summarizeTenant(t, reportFor(t).requests))
        : tenant.orgId && tenant.role === "owner"
        ? store.membersOf(tenant.orgId).map((t) => summarizeTenant(t, reportFor(t).requests))
        : [summarizeTenant(tenant, reportFor(tenant).requests)];
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
      await handleRepoRoute(root, repoMatch[2], url, res, opts.rankMlModelDir);
      return;
    }

    // Single-repo shortcuts, kept for zero-config local use.
    if (soleName && path.startsWith("/v1/")) {
      if (tenant && !tenantMayAccess(tenant, soleName)) {
        sendJson(res, 403, { error: `tenant '${tenant.name}' has no access to repo '${soleName}'` });
        return;
      }
      await handleRepoRoute(repos[soleName], path.slice("/v1/".length), url, res, opts.rankMlModelDir);
      return;
    }

    // Everything reaching here is under /v1/* (the check above already
    // handled every other path) — API clients get JSON, which is what they parse.
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
