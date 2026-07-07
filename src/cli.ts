#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { analyzeRepo } from "./analyzer.js";
import { generateAll, mergePreservingManual } from "./generators.js";
import { indexCommits, writeMemory, MEMORY_PATH } from "./memory.js";
import { createContextServer } from "./server.js";

const USAGE = `mindset-ctx — Context-as-a-Service for your repos

Usage:
  ctx generate [path]          Analyze the repo and (re)generate context files:
                               CLAUDE.md, AGENTS.md, docs/ARCHITECTURE.md,
                               CONTRIBUTING.md, .context/prompts.md
  ctx index [path] [--limit N] Index git history into the memory layer
                               (${MEMORY_PATH})
  ctx serve [path] [--port N]  Serve the context over HTTP for AI tools
  ctx analyze [path]           Print the raw repo analysis as JSON
  ctx help                     Show this help

Hand-written content below the "ctx:manual" marker in generated files is
preserved across regenerations.`;

function arg(flag: string, argv: string[]): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

function targetDir(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      i++; // skip the flag's value
      continue;
    }
    return resolve(argv[i]);
  }
  return resolve(".");
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

function cmdIndex(root: string, argv: string[]): void {
  const limit = Number(arg("--limit", argv) ?? 500) || 500;
  const records = indexCommits(root, limit);
  const path = writeMemory(root, records);
  console.log(`Indexed ${records.length} record(s) into ${path}`);
}

function cmdServe(root: string, argv: string[]): void {
  const port = Number(arg("--port", argv) ?? 4870) || 4870;
  createContextServer(root).listen(port, () => {
    console.log(`mindset-ctx serving ${root}`);
    console.log(`  http://localhost:${port}/v1/health`);
    console.log(`  http://localhost:${port}/v1/analysis`);
    console.log(`  http://localhost:${port}/v1/context/claude   (agents|architecture|contributing|prompts)`);
    console.log(`  http://localhost:${port}/v1/memory/search?q=fix`);
  });
}

const [, , command, ...rest] = process.argv;
const root = targetDir(rest);

switch (command) {
  case "generate":
    cmdGenerate(root);
    break;
  case "index":
    cmdIndex(root, rest);
    break;
  case "serve":
    cmdServe(root, rest);
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
