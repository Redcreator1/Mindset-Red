import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, normalize } from "node:path";
import { analyzeRepo } from "./analyzer.js";
import { loadMemory, searchMemory } from "./memory.js";

/**
 * Context API so AI tools (Claude Code, Cursor, …) can pull always-fresh
 * context over HTTP. Serves one or many repos from a single process — the
 * seed of the hosted multi-repo mode.
 *
 *   GET /v1/health                             — liveness (never requires auth)
 *   GET /v1/repos                              — registered repos
 *   GET /v1/repos/:repo/analysis               — structured repo analysis (JSON)
 *   GET /v1/repos/:repo/context/:name          — a context file (claude, agents, …)
 *   GET /v1/repos/:repo/memory/search?q=&limit=— relevance-ranked memory search
 *
 * When exactly one repo is registered, the unprefixed shortcuts
 * /v1/analysis, /v1/context/:name and /v1/memory/search keep working.
 *
 * Auth: pass { apiKey } (or CTX_API_KEY via the CLI) to require
 * `Authorization: Bearer <key>` or `x-api-key: <key>` on every route
 * except /v1/health.
 */

export interface ServerOptions {
  apiKey?: string;
}

const CONTEXT_FILES: Record<string, string> = {
  "claude": "CLAUDE.md",
  "agents": "AGENTS.md",
  "architecture": "docs/ARCHITECTURE.md",
  "contributing": "CONTRIBUTING.md",
  "prompts": ".context/prompts.md",
};

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/markdown; charset=utf-8" });
  res.end(text);
}

function authorized(req: IncomingMessage, apiKey: string | undefined): boolean {
  if (!apiKey) return true;
  const bearer = req.headers.authorization;
  if (bearer === `Bearer ${apiKey}`) return true;
  return req.headers["x-api-key"] === apiKey;
}

/** Normalize the repos argument: a single root or a name→root map. */
function toRepoMap(rootOrRepos: string | Record<string, string>): Record<string, string> {
  if (typeof rootOrRepos === "string") return { [basename(rootOrRepos) || "repo"]: rootOrRepos };
  return rootOrRepos;
}

function handleRepoRoute(root: string, sub: string, url: URL, res: ServerResponse): void {
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
    const records = loadMemory(root);
    sendJson(res, 200, { query: q, total: records.length, results: searchMemory(records, q, limit) });
    return;
  }

  sendJson(res, 404, { error: "not found", routes: ["analysis", "context/:name", "memory/search?q="] });
}

export function createContextServer(rootOrRepos: string | Record<string, string>, opts: ServerOptions = {}) {
  const repos = toRepoMap(rootOrRepos);
  const names = Object.keys(repos);
  const soleRoot = names.length === 1 ? repos[names[0]] : null;

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }

    if (path === "/v1/health" || path === "/") {
      sendJson(res, 200, { ok: true, service: "mindset-ctx", repos: names });
      return;
    }

    if (!authorized(req, opts.apiKey)) {
      sendJson(res, 401, { error: "unauthorized — pass Authorization: Bearer <key> or x-api-key" });
      return;
    }

    if (path === "/v1/repos") {
      sendJson(res, 200, { repos: names.map((name) => ({ name, root: repos[name] })) });
      return;
    }

    const repoMatch = path.match(/^\/v1\/repos\/([^/]+)\/(.+)$/);
    if (repoMatch) {
      const root = repos[decodeURIComponent(repoMatch[1])];
      if (!root) {
        sendJson(res, 404, { error: `unknown repo '${repoMatch[1]}'`, repos: names });
        return;
      }
      handleRepoRoute(root, repoMatch[2], url, res);
      return;
    }

    // Single-repo shortcuts, kept for zero-config local use.
    if (soleRoot && path.startsWith("/v1/")) {
      handleRepoRoute(soleRoot, path.slice("/v1/".length), url, res);
      return;
    }

    sendJson(res, 404, {
      error: "not found",
      routes: ["/v1/health", "/v1/repos", "/v1/repos/:repo/analysis", "/v1/repos/:repo/context/:name", "/v1/repos/:repo/memory/search?q="],
    });
  });
}
