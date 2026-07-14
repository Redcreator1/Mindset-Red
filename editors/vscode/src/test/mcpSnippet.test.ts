import test from "node:test";
import assert from "node:assert/strict";
import { buildClaudeMcpCommand, buildCursorMcpConfig } from "../mcpSnippet";

test("buildClaudeMcpCommand wires the CLI command and workspace root into a claude mcp add invocation", () => {
  const cmd = buildClaudeMcpCommand("node /repo/dist/cli.js", "/home/dev/my-project");
  assert.equal(cmd, 'claude mcp add mindset-ctx -- node /repo/dist/cli.js mcp "/home/dev/my-project"');
});

test("buildClaudeMcpCommand works with a globally-installed cli command too", () => {
  const cmd = buildClaudeMcpCommand("ctx", "/home/dev/my-project");
  assert.equal(cmd, 'claude mcp add mindset-ctx -- ctx mcp "/home/dev/my-project"');
});

test("buildCursorMcpConfig splits a multi-word cli command into command + args correctly", () => {
  const json = buildCursorMcpConfig("node /repo/dist/cli.js", "/home/dev/my-project");
  const parsed = JSON.parse(json) as { mcpServers: Record<string, { command: string; args: string[] }> };
  assert.deepEqual(parsed.mcpServers["mindset-ctx"], {
    command: "node",
    args: ["/repo/dist/cli.js", "mcp", "/home/dev/my-project"],
  });
});

test("buildCursorMcpConfig works with a single-word cli command (no extra args to preserve)", () => {
  const json = buildCursorMcpConfig("ctx", "/home/dev/my-project");
  const parsed = JSON.parse(json) as { mcpServers: Record<string, { command: string; args: string[] }> };
  assert.deepEqual(parsed.mcpServers["mindset-ctx"], { command: "ctx", args: ["mcp", "/home/dev/my-project"] });
});
