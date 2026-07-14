/**
 * Pure string-building — no `vscode` import, so this can be unit-tested with
 * plain node:test instead of the full Extension Host (see test/mcpSnippet.test.ts).
 */

/** The `claude mcp add` invocation that wires this workspace's context into Claude Code. */
export function buildClaudeMcpCommand(cliCommand: string, workspaceRoot: string): string {
  return `claude mcp add mindset-ctx -- ${cliCommand} mcp "${workspaceRoot}"`;
}

/** The equivalent .cursor/mcp.json entry, for editors that read that file instead. */
export function buildCursorMcpConfig(cliCommand: string, workspaceRoot: string): string {
  const [command, ...args] = cliCommand.split(" ");
  return JSON.stringify(
    {
      mcpServers: {
        "mindset-ctx": { command, args: [...args, "mcp", workspaceRoot] },
      },
    },
    null,
    2,
  );
}
