import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeRepo } from "./analyzer.js";
import { loadMemory, searchMemory } from "./memory.js";
import { CONTEXT_FILES } from "./server.js";

/**
 * MCP (Model Context Protocol) server over stdio, so AI tools (Claude Code,
 * Cursor, …) can consume the repo's context natively as tools instead of
 * calling the HTTP API. JSON-RPC 2.0, newline-delimited, zero dependencies.
 *
 * Register in Claude Code:  claude mcp add mindset-ctx -- node dist/cli.js mcp /path/to/repo
 */

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const TOOLS = [
  {
    name: "get_context",
    description:
      "Read a generated context file of the repository. Names: claude (CLAUDE.md), agents (AGENTS.md), architecture, contributing, prompts.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", enum: Object.keys(CONTEXT_FILES), description: "Which context file to read" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "search_memory",
    description:
      "Search the repository memory layer (commits, PRs, issues, discussions) by keywords, ranked by BM25 relevance. Use it to find past decisions before re-deciding something.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords to search for" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "analyze_repo",
    description: "Get a fresh structured analysis of the repository: languages, frameworks, scripts, layout, dependencies.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function textResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function callTool(root: string, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "get_context": {
      const file = CONTEXT_FILES[String(args.name)];
      if (!file) return textResult(`Unknown context '${args.name}'. Available: ${Object.keys(CONTEXT_FILES).join(", ")}`, true);
      const full = join(root, file);
      if (!existsSync(full)) return textResult(`${file} not generated yet — run \`ctx generate\` first.`, true);
      return textResult(readFileSync(full, "utf8"));
    }
    case "search_memory": {
      const limit = Math.min(Number(args.limit ?? 10) || 10, 50);
      const hits = searchMemory(loadMemory(root), String(args.query ?? ""), limit);
      if (hits.length === 0) return textResult("No matching records in the memory layer.");
      return textResult(JSON.stringify(hits, null, 2));
    }
    case "analyze_repo":
      return textResult(JSON.stringify(analyzeRepo(root), null, 2));
    default:
      return textResult(`Unknown tool '${name}'`, true);
  }
}

/**
 * Pure request handler, separated from stdio so it can be unit-tested.
 * Returns null for notifications (no response expected).
 */
export function createMcpHandler(root: string, version: string) {
  return function handle(req: JsonRpcRequest): JsonRpcResponse | null {
    const id = req.id ?? null;
    const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

    try {
      switch (req.method) {
        case "initialize":
          return reply({
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "mindset-ctx", version },
          });
        case "notifications/initialized":
        case "notifications/cancelled":
          return null;
        case "ping":
          return reply({});
        case "tools/list":
          return reply({ tools: TOOLS });
        case "tools/call": {
          const params = req.params ?? {};
          const name = String(params.name ?? "");
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          return reply(callTool(root, name, args));
        }
        default:
          return req.id === undefined ? null : fail(-32601, `Method not found: ${req.method}`);
      }
    } catch (err) {
      return fail(-32603, `Internal error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

/** Wire the handler to stdin/stdout (newline-delimited JSON-RPC). */
export function runMcpServer(root: string, version: string): void {
  const handle = createMcpHandler(root, version);
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line) as JsonRpcRequest;
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
      return;
    }
    const res = handle(req);
    if (res) process.stdout.write(JSON.stringify(res) + "\n");
  });
}
