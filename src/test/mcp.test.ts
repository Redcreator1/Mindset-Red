import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpHandler } from "../mcp.js";
import { analyzeRepo } from "../analyzer.js";
import { generateAll } from "../generators.js";
import { indexCommits, writeMemory } from "../memory.js";
import { dirname } from "node:path";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ctx-mcp-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "mcp-fixture", description: "MCP fixture" }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t.t" };
  execFileSync("git", ["-C", dir, "init", "-q"], { env });
  execFileSync("git", ["-C", dir, "add", "."], { env });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "feat: rocket launcher module"], { env });
  for (const f of generateAll(analyzeRepo(dir))) {
    const full = join(dir, f.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.content);
  }
  writeMemory(dir, indexCommits(dir));
  return dir;
}

test("MCP server implements the protocol lifecycle and tools", () => {
  const handle = createMcpHandler(makeRepo(), "0.3.0");

  const init = handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal((init?.result as { protocolVersion: string }).protocolVersion, "2025-06-18");
  assert.equal((init?.result as { serverInfo: { name: string } }).serverInfo.name, "mindset-ctx");

  assert.equal(handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null, "notifications get no response");

  const list = handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (list?.result as { tools: { name: string }[] }).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["analyze_repo", "get_context", "search_memory"]);

  const ctx = handle({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "get_context", arguments: { name: "claude" } },
  });
  const ctxResult = ctx?.result as { content: { text: string }[]; isError: boolean };
  assert.equal(ctxResult.isError, false);
  assert.ok(ctxResult.content[0].text.includes("mcp-fixture"));

  const search = handle({
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "search_memory", arguments: { query: "rocket launcher" } },
  });
  const searchResult = search?.result as { content: { text: string }[] };
  assert.ok(searchResult.content[0].text.includes("rocket launcher module"));

  const analyze = handle({
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "analyze_repo", arguments: {} },
  });
  assert.ok((analyze?.result as { content: { text: string }[] }).content[0].text.includes("\"name\": \"mcp-fixture\""));

  const badTool = handle({
    jsonrpc: "2.0", id: 6, method: "tools/call",
    params: { name: "nope", arguments: {} },
  });
  assert.equal((badTool?.result as { isError: boolean }).isError, true);

  const badMethod = handle({ jsonrpc: "2.0", id: 7, method: "does/not/exist" });
  assert.equal(badMethod?.error?.code, -32601);
});
