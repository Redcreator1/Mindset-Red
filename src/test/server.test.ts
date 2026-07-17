import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createContextServer } from "../server.js";
import { indexCommits, writeMemory } from "../memory.js";

function makeRepo(name: string, commitMsg: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ctx-${name}-`));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, description: `${name} fixture` }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t.t" };
  execFileSync("git", ["-C", dir, "init", "-q"], { env });
  execFileSync("git", ["-C", dir, "add", "."], { env });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", commitMsg], { env });
  writeMemory(dir, indexCommits(dir));
  return dir;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, r));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test("multi-repo server routes per repo and lists them", async () => {
  const alpha = makeRepo("alpha", "feat: alpha payments module");
  const beta = makeRepo("beta", "fix: beta notification bug");
  const server = createContextServer({ alpha, beta });
  const base = await listen(server);

  try {
    const health = await (await fetch(`${base}/v1/health`)).json() as { ok: boolean; repos: string[] };
    assert.equal(health.ok, true);
    assert.deepEqual(health.repos.sort(), ["alpha", "beta"]);

    const repos = await (await fetch(`${base}/v1/repos`)).json() as { repos: { name: string }[] };
    assert.equal(repos.repos.length, 2);

    const alphaAnalysis = await (await fetch(`${base}/v1/repos/alpha/analysis`)).json() as { name: string };
    assert.equal(alphaAnalysis.name, "alpha");

    const betaSearch = await (await fetch(`${base}/v1/repos/beta/memory/search?q=notification`)).json() as { results: { title: string }[] };
    assert.equal(betaSearch.results.length, 1);
    assert.match(betaSearch.results[0].title, /notification/);

    const alphaSearch = await (await fetch(`${base}/v1/repos/alpha/memory/search?q=notification`)).json() as { results: unknown[] };
    assert.equal(alphaSearch.results.length, 0, "memory is per-repo");

    const unknown = await fetch(`${base}/v1/repos/gamma/analysis`);
    assert.equal(unknown.status, 404);

    // Inherited object-prototype names must 404 like any unknown repo —
    // plain indexing would resolve them ("__proto__" → Object.prototype,
    // truthy) and crash deeper in with a 500.
    for (const name of ["__proto__", "constructor"]) {
      const inherited = await fetch(`${base}/v1/repos/${name}/analysis`);
      assert.equal(inherited.status, 404, `'${name}' must be a plain unknown-repo 404`);
    }

    const noShortcut = await fetch(`${base}/v1/analysis`);
    assert.equal(noShortcut.status, 404, "unprefixed shortcuts are single-repo only");
  } finally {
    server.close();
  }
});

test("api key protects every route except health", async () => {
  const repo = makeRepo("secured", "feat: secret sauce");
  const server = createContextServer({ secured: repo }, { apiKey: "s3cret" });
  const base = await listen(server);

  try {
    const health = await fetch(`${base}/v1/health`);
    assert.equal(health.status, 200, "health stays open for probes");

    assert.equal((await fetch(`${base}/v1/repos`)).status, 401);
    assert.equal((await fetch(`${base}/v1/analysis`)).status, 401);
    assert.equal((await fetch(`${base}/v1/repos`, { headers: { authorization: "Bearer wrong" } })).status, 401);

    const bearer = await fetch(`${base}/v1/repos`, { headers: { authorization: "Bearer s3cret" } });
    assert.equal(bearer.status, 200);

    const headerKey = await fetch(`${base}/v1/analysis`, { headers: { "x-api-key": "s3cret" } });
    assert.equal(headerKey.status, 200);
  } finally {
    server.close();
  }
});
