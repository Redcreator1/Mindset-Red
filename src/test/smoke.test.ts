import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeRepo } from "../analyzer.js";
import { generateAll, mergePreservingManual, MANUAL_MARKER } from "../generators.js";
import { indexCommits, writeMemory, loadMemory, searchMemory } from "../memory.js";
import { createContextServer } from "../server.js";

function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ctx-fixture-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "fixture-app",
      description: "A tiny fixture app",
      scripts: { test: "node --test" },
      dependencies: { react: "^18.0.0" },
    }),
  );
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "README.md"), "# fixture\n\nA tiny fixture app.\n");

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t.t" } });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "feat: initial fixture commit");
  writeFileSync(join(dir, "src", "extra.ts"), "export const y = 2;\n");
  git("add", ".");
  git("commit", "-q", "-m", "fix: add extra module for search testing");
  return dir;
}

test("analyzeRepo detects languages, scripts and frameworks", () => {
  const dir = makeFixtureRepo();
  const a = analyzeRepo(dir);
  assert.equal(a.name, "fixture-app");
  assert.equal(a.description, "A tiny fixture app");
  assert.ok(a.languages.some((l) => l.language === "TypeScript"));
  assert.ok(a.frameworks.includes("React"));
  assert.ok(a.hasTests);
  assert.ok(a.fileCount >= 3);
});

test("generateAll produces the five context files", () => {
  const a = analyzeRepo(makeFixtureRepo());
  const files = generateAll(a);
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, [".context/prompts.md", "AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", "docs/ARCHITECTURE.md"]);
  for (const f of files) {
    assert.ok(f.content.includes(MANUAL_MARKER), `${f.path} must contain the manual marker`);
    assert.ok(f.content.includes("fixture-app"), `${f.path} must mention the repo name`);
  }
});

test("mergePreservingManual keeps hand-written content", () => {
  const a = analyzeRepo(makeFixtureRepo());
  const [claude] = generateAll(a);
  const edited = claude.content + "\n## My notes\n\nNever lose this.\n";
  const merged = mergePreservingManual(claude.content, edited);
  assert.ok(merged.includes("Never lose this."));
  assert.equal(merged.indexOf(MANUAL_MARKER), merged.lastIndexOf(MANUAL_MARKER));
});

test("memory layer indexes commits and searches them", () => {
  const dir = makeFixtureRepo();
  const records = indexCommits(dir);
  assert.equal(records.length, 2);
  assert.equal(records[0].type, "commit");
  assert.ok(records.some((r) => r.files.includes("src/extra.ts")));

  writeMemory(dir, records);
  assert.ok(existsSync(join(dir, ".context", "memory.jsonl")));
  const loaded = loadMemory(dir);
  assert.equal(loaded.length, 2);

  const hits = searchMemory(loaded, "extra module");
  assert.equal(hits.length, 1);
  assert.match(hits[0].title, /extra module/);
  assert.equal(searchMemory(loaded, "nonexistent-term").length, 0);
});

test("searchMemory ranks by BM25 relevance", () => {
  const mk = (id: string, title: string, body = ""): import("../types.js").MemoryRecord => ({
    type: "commit", id, title, body, author: "dev", date: "2026-01-01", files: [],
  });
  const records = [
    mk("1", "refactor payment gateway", "touch retry logic in payment flow"),
    mk("2", "payment retry: exponential backoff for payment gateway timeouts"),
    mk("3", "update readme"),
  ];
  const hits = searchMemory(records, "payment retry");
  assert.equal(hits.length, 2, "readme commit must not match");
  assert.equal(hits[0].id, "2", "record matching both terms most densely ranks first");
  assert.equal(searchMemory(records, "").length, 3, "empty query returns everything up to limit");
});

test("context server serves analysis, context files and memory search", async () => {
  const dir = makeFixtureRepo();
  const a = analyzeRepo(dir);
  for (const f of generateAll(a)) {
    const full = join(dir, f.path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, f.content);
  }
  writeMemory(dir, indexCommits(dir));

  const server = createContextServer(dir);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await (await fetch(`${base}/v1/health`)).json() as { ok: boolean };
    assert.equal(health.ok, true);

    const analysis = await (await fetch(`${base}/v1/analysis`)).json() as { name: string };
    assert.equal(analysis.name, "fixture-app");

    const claudeRes = await fetch(`${base}/v1/context/claude`);
    assert.equal(claudeRes.status, 200);
    assert.ok((await claudeRes.text()).includes("fixture-app"));

    const unknown = await fetch(`${base}/v1/context/nope`);
    assert.equal(unknown.status, 404);

    const search = await (await fetch(`${base}/v1/memory/search?q=extra`)).json() as { total: number; results: unknown[] };
    assert.equal(search.total, 2);
    assert.equal(search.results.length, 1);
  } finally {
    server.close();
  }
});
