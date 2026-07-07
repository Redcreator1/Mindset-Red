import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { analyzeRepo } from "./analyzer.js";
import { loadMemory, searchMemory } from "./memory.js";

/**
 * Minimal Context API so AI tools (Claude Code, Cursor, …) can pull
 * always-fresh context over HTTP.
 *
 *   GET /v1/health                     — liveness
 *   GET /v1/analysis                   — structured repo analysis (JSON)
 *   GET /v1/context/:name              — a context file (CLAUDE.md, AGENTS.md, ...)
 *   GET /v1/memory/search?q=…&limit=…  — keyword search over the memory layer
 */

const CONTEXT_FILES: Record<string, string> = {
  "claude": "CLAUDE.md",
  "agents": "AGENTS.md",
  "architecture": "docs/ARCHITECTURE.md",
  "contributing": "CONTRIBUTING.md",
  "prompts": ".context/prompts.md",
};

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/markdown; charset=utf-8" });
  res.end(text);
}

export function createContextServer(root: string) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }

    if (path === "/v1/health" || path === "/") {
      sendJson(res, 200, { ok: true, service: "mindset-ctx", root });
      return;
    }

    if (path === "/v1/analysis") {
      sendJson(res, 200, analyzeRepo(root));
      return;
    }

    const contextMatch = path.match(/^\/v1\/context\/([a-z-]+)$/);
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

    if (path === "/v1/memory/search") {
      const q = url.searchParams.get("q") ?? "";
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100);
      const records = loadMemory(root);
      sendJson(res, 200, { query: q, total: records.length, results: searchMemory(records, q, limit) });
      return;
    }

    sendJson(res, 404, { error: "not found", routes: ["/v1/health", "/v1/analysis", "/v1/context/:name", "/v1/memory/search?q="] });
  });
}
