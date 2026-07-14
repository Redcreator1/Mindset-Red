import * as vscode from "vscode";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildClaudeMcpCommand } from "./mcpSnippet";
import { statusFor } from "./statusText";

const execFileAsync = promisify(execFile);

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Defaults to `npx mindset-ctx` (the package is on npm); if the user cleared
 * the setting, ask once and save it. Machine-scoped setting → Global target:
 * the command gets executed, so a repository's .vscode/settings.json must
 * never be able to plant it.
 */
async function resolveCliCommand(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("mindsetCtx");
  const configured = config.get<string>("cliCommand", "").trim();
  if (configured) return configured;

  const entered = await vscode.window.showInputBox({
    title: "mindset-ctx CLI command",
    prompt: 'How do you run the mindset-ctx CLI? (e.g. "npx mindset-ctx", "ctx" if installed globally, or "node /path/to/mindset-ctx/dist/cli.js")',
    placeHolder: "npx mindset-ctx",
  });
  if (!entered) return undefined;
  await config.update("cliCommand", entered, vscode.ConfigurationTarget.Global);
  return entered;
}

async function runCliCommand(subcommand: string, label: string): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage("mindset-ctx: open a folder first.");
    return;
  }
  const cli = await resolveCliCommand();
  if (!cli) return;

  // execFile (not exec): no shell ever sees these strings, so a workspace
  // path — or a cliCommand — containing quotes/$()/backticks can't inject.
  const [command, ...cliArgs] = cli.split(" ").filter(Boolean);
  const args = [...cliArgs, subcommand, root];
  outputChannel.show(true);
  outputChannel.appendLine(`$ ${command} ${args.join(" ")}`);
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd: root });
    if (stdout) outputChannel.appendLine(stdout);
    if (stderr) outputChannel.appendLine(stderr);
    vscode.window.showInformationMessage(`mindset-ctx: ${label} done.`);
  } catch (err) {
    outputChannel.appendLine(String(err));
    vscode.window.showErrorMessage(`mindset-ctx: ${label} failed — see the "mindset-ctx" Output panel.`);
  } finally {
    updateStatusBar();
  }
}

async function copyMcpConfig(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage("mindset-ctx: open a folder first.");
    return;
  }
  const cli = await resolveCliCommand();
  if (!cli) return;
  await vscode.env.clipboard.writeText(buildClaudeMcpCommand(cli, root));
  vscode.window.showInformationMessage("mindset-ctx: MCP command copied to clipboard — paste it into your terminal.");
}

async function openDashboard(): Promise<void> {
  const url = vscode.workspace.getConfiguration("mindsetCtx").get<string>("dashboardUrl", "").trim();
  if (!url) {
    vscode.window.showWarningMessage('mindset-ctx: set "mindsetCtx.dashboardUrl" in settings first.');
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
}

function updateStatusBar(): void {
  const root = workspaceRoot();
  if (!root) {
    statusBarItem.hide();
    return;
  }
  const { text, tooltip } = statusFor(existsSync(join(root, "CLAUDE.md")));
  statusBarItem.text = text;
  statusBarItem.tooltip = tooltip;
  statusBarItem.command = "mindsetCtx.generate";
  statusBarItem.show();
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("mindset-ctx");
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(outputChannel, statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("mindsetCtx.generate", () => runCliCommand("generate", "generating context")),
    vscode.commands.registerCommand("mindsetCtx.index", () => runCliCommand("index", "indexing memory")),
    vscode.commands.registerCommand("mindsetCtx.copyMcpConfig", copyMcpConfig),
    vscode.commands.registerCommand("mindsetCtx.openDashboard", openDashboard),
  );

  if (vscode.workspace.workspaceFolders?.length) {
    context.subscriptions.push(
      vscode.workspace.onDidCreateFiles(updateStatusBar),
      vscode.workspace.onDidDeleteFiles(updateStatusBar),
    );
  }
  updateStatusBar();
}

export function deactivate(): void {}
