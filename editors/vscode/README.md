# mindset-ctx for VS Code

Generate and keep AI context files (`CLAUDE.md`, `AGENTS.md`, architecture docs)
fresh, and wire the MCP server into Claude Code / Cursor, without leaving the
editor.

Not yet on the VS Code Marketplace — mindset-ctx itself isn't published to npm
yet either, so this talks to a **local clone** of the CLI (`node dist/cli.js`)
or a global/npm-linked `ctx` binary. See the root [README](../../README.md)
for how to build the CLI.

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search "mindset-ctx":

- **mindset-ctx: Generate Context Files** — runs `ctx generate` on the open workspace.
- **mindset-ctx: Index Memory** — runs `ctx index` (commit history, and PRs/issues if configured).
- **mindset-ctx: Copy MCP Server Command** — copies the `claude mcp add …` command for this workspace to the clipboard.
- **mindset-ctx: Open Hosted Dashboard** — opens the URL set in `mindsetCtx.dashboardUrl`.

A status bar item on the right shows whether `CLAUDE.md` exists in the open
workspace; click it to generate one.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mindsetCtx.cliCommand` | *(empty — asked once)* | How to invoke the CLI, e.g. `ctx` or `node /path/to/mindset-ctx/dist/cli.js` |
| `mindsetCtx.dashboardUrl` | *(empty)* | Hosted dashboard URL for "Open Hosted Dashboard" |

## Try it locally (not published yet)

```bash
cd editors/vscode
npm install
npm run build
```

Then press `F5` in VS Code (with this folder open) to launch an Extension
Development Host with it loaded — or package it:

```bash
npx @vscode/vsce package   # → mindset-ctx-0.1.0.vsix
code --install-extension mindset-ctx-0.1.0.vsix
```

## Testing

`npm test` runs the pure logic (MCP command building, status bar text) under
plain `node:test` — no VS Code Extension Host needed for that part. The
`vscode`-API-calling glue in `src/extension.ts` is exercised manually via `F5`,
not by an automated suite: `@vscode/test-electron` needs to download an actual
VS Code binary and a display, which this environment's sandbox doesn't have
(no outbound access to the download host, no X server). If you have a machine
with VS Code installed, `F5` is the real test.
