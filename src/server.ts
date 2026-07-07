import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { analyzeRepo } from "./analyzer.js";
import { generateAll, mergePreservingManual } from "./generators.js";
import { indexCommits, loadMemory, mergeRecords, searchMemory, writeMemory } from "./memory.js";
import { semanticSearch } from "./embeddings.js";
import { UsageMeter, tenantForKey, tenantMayAccess, type Tenant } from "./tenants.js";

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
 *   GET  /v1/repos/:repo/memory/search?q=&mode= — memory search (BM25; mode=semantic
 *                                                 uses Voyage embeddings, needs
 *                                                 VOYAGE_API_KEY + `ctx index --embed`)
 *   POST /v1/repos/:repo/webhook                — GitHub webhook (push/issues/PR):
 *                                                 verifies X-Hub-Signature-256 and
 *                                                 refreshes memory + context files
 *
 * When exactly one repo is registered, the unprefixed shortcuts keep working.
 *
 * Auth:
 *  - { apiKey }: single shared key on every route except /v1/health (Bearer
 *    or x-api-key). The webhook route authenticates via HMAC instead.
 *  - { tenants }: per-tenant keys with repo scopes and daily quotas — the
 *    seed of the hosted micro-SaaS (metering via /v1/usage).
 */

export interface ServerOptions {
  apiKey?: string;
  tenants?: Tenant[];
  /** Shared secret for GitHub webhook signature verification. */
  webhookSecret?: string;
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
    if (mode === "semantic") {
      try {
        const results = await semanticSearch(root, records, q, limit);
        sendJson(res, 200, { query: q, mode, total: records.length, results });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    sendJson(res, 200, { query: q, mode: "lexical", total: records.length, results: searchMemory(records, q, limit) });
    return;
  }

  sendJson(res, 404, { error: "not found", routes: ["analysis", "context/:name", "memory/search?q=", "webhook (POST)"] });
}

export function createContextServer(rootOrRepos: string | Record<string, string>, opts: ServerOptions = {}) {
  const repos = toRepoMap(rootOrRepos);
  const names = Object.keys(repos);
  const soleName = names.length === 1 ? names[0] : null;
  const tenants = opts.tenants ?? [];
  const meter = new UsageMeter();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/v1/health" || path === "/") {
      sendJson(res, 200, { ok: true, service: "mindset-ctx", repos: names });
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
      if (!validSignature(opts.webhookSecret, body, req.headers["x-hub-signature-256"] as string | undefined)) {
        sendJson(res, 401, { error: "invalid webhook signature" });
        return;
      }
      const event = String(req.headers["x-github-event"] ?? "unknown");
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
    if (tenants.length > 0) {
      tenant = tenantForKey(tenants, requestKey(req));
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
        "/v1/health", "/v1/repos", "/v1/usage",
        "/v1/repos/:repo/analysis", "/v1/repos/:repo/context/:name",
        "/v1/repos/:repo/memory/search?q=", "POST /v1/repos/:repo/webhook",
      ],
    });
  }

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });
}
