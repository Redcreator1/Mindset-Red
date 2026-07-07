#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { analyzeRepo } from "./analyzer.js";
import { generateAll, mergePreservingManual } from "./generators.js";
import { indexCommits, writeMemory, mergeRecords, MEMORY_PATH } from "./memory.js";
import { fetchGitHubMemory, parseRepoFromRemote } from "./github.js";
import { createContextServer } from "./server.js";

const USAGE = `mindset-ctx — Context-as-a-Service for your repos

Usage:
  ctx generate [path]          Analyze the repo and (re)generate context files:
                               CLAUDE.md, AGENTS.md, docs/ARCHITECTURE.md,
                               CONTRIBUTING.md, .context/prompts.md
  ctx index [path] [--limit N] [--github] [--repo owner/name]
                               Index git history into the memory layer
                               (${MEMORY_PATH}). With --github, also ingest
                               PRs, issues and discussions via the GitHub API
                               (owner/name inferred from the origin remote
                               unless --repo is given; set GITHUB_TOKEN for
                               private repos / higher rate limits)
  ctx serve [path ...] [--port N] [--api-key KEY]
                               Serve one or more repos over HTTP for AI tools.
                               Multiple paths enable /v1/repos/:name/… routes;
                               --api-key (or CTX_API_KEY) protects every route
                               except /v1/health
  ctx analyze [path]           Print the raw repo analysis as JSON
  ctx help                     Show this help

Hand-written content below the "ctx:manual" marker in generated files is
preserved across regenerations.`;

/** Flags that take no value; every other --flag consumes the next token. */
const BOOLEAN_FLAGS = new Set(["--github"]);

function arg(flag: string, argv: string[]): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

function positionals(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      if (!BOOLEAN_FLAGS.has(argv[i])) i++; // skip the flag's value
      continue;
    }
    out.push(argv[i]);
  }
  return out;
}

function targetDir(argv: string[]): string {
  return resolve(positionals(argv)[0] ?? ".");
}

function cmdGenerate(root: string): void {
  const analysis = analyzeRepo(root);
  const files = generateAll(analysis);
  for (const file of files) {
    const full = join(root, file.path);
    const existing = existsSync(full) ? readFileSync(full, "utf8") : null;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, mergePreservingManual(file.content, existing));
    console.log(`${existing ? "updated " : "created "} ${file.path}`);
  }
  console.log(`\nContext generated for ${analysis.name} (${analysis.fileCount} files scanned).`);
}

async function cmdIndex(root: string, argv: string[]): Promise<void> {
  const limit = Number(arg("--limit", argv) ?? 500) || 500;
  let records = indexCommits(root, limit);
  console.log(`Indexed ${records.length} commit(s) from git history`);

  if (argv.includes("--github")) {
    const repoFlag = arg("--repo", argv);
    const target = repoFlag
      ? { owner: repoFlag.split("/")[0], repo: repoFlag.split("/")[1] }
      : parseRepoFromRemote(analyzeRepo(root).remote);
    if (!target?.owner || !target?.repo) {
      console.error("Cannot determine GitHub repo: no origin remote found — pass --repo owner/name.");
      process.exit(1);
    }
    const gh = await fetchGitHubMemory(target.owner, target.repo, { limit });
    console.log(`Fetched ${gh.length} PR/issue/discussion record(s) from ${target.owner}/${target.repo}`);
    records = mergeRecords(records, gh);
  }

  const path = writeMemory(root, records);
  console.log(`Wrote ${records.length} record(s) to ${path}`);
}

function cmdServe(argv: string[]): void {
  const port = Number(arg("--port", argv) ?? 4870) || 4870;
  const apiKey = arg("--api-key", argv) ?? process.env.CTX_API_KEY;
  const paths = positionals(argv).map((p) => resolve(p));
  if (paths.length === 0) paths.push(resolve("."));
  const repos = Object.fromEntries(paths.map((p) => [basename(p) || "repo", p]));

  createContextServer(repos, { apiKey }).listen(port, () => {
    const names = Object.keys(repos);
    console.log(`mindset-ctx serving ${names.length} repo(s): ${names.join(", ")}${apiKey ? " [api-key required]" : ""}`);
    console.log(`  http://localhost:${port}/v1/health`);
    console.log(`  http://localhost:${port}/v1/repos`);
    if (names.length === 1) {
      console.log(`  http://localhost:${port}/v1/context/claude   (agents|architecture|contributing|prompts)`);
      console.log(`  http://localhost:${port}/v1/memory/search?q=fix`);
    } else {
      console.log(`  http://localhost:${port}/v1/repos/${names[0]}/context/claude`);
      console.log(`  http://localhost:${port}/v1/repos/${names[0]}/memory/search?q=fix`);
    }
  });
}

const [, , command, ...rest] = process.argv;
const root = targetDir(rest);

switch (command) {
  case "generate":
    cmdGenerate(root);
    break;
  case "index":
    await cmdIndex(root, rest);
    break;
  case "serve":
    cmdServe(rest);
    break;
  case "analyze":
    console.log(JSON.stringify(analyzeRepo(root), null, 2));
    break;
  case "help":
  case undefined:
    console.log(USAGE);
    break;
  default:
    console.error(`Unknown command '${command}'.\n`);
    console.log(USAGE);
    process.exit(1);
}
