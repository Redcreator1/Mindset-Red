import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectDefaultBranch } from "../analyzer.js";

const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t.t" };
const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { env, stdio: "pipe" });

function repo(initialBranch: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ctx-branch-"));
  git(dir, "init", "-q", "-b", initialBranch);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

test("default branch is main, not the feature branch checked out", () => {
  const dir = repo("main");
  git(dir, "checkout", "-q", "-b", "feat/something");
  assert.equal(detectDefaultBranch(dir), "main");
});

test("master is detected the same way", () => {
  const dir = repo("master");
  git(dir, "checkout", "-q", "-b", "fix/x");
  assert.equal(detectDefaultBranch(dir), "master");
});

test("origin/HEAD wins, and slashes in its name are kept", () => {
  const dir = repo("release/2026");
  git(dir, "update-ref", "refs/remotes/origin/release/2026", "HEAD");
  git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/release/2026");
  git(dir, "checkout", "-q", "-b", "feat/y");
  assert.equal(detectDefaultBranch(dir), "release/2026");
});

test("falls back to the current branch when nothing else is known", () => {
  const dir = repo("trunk");
  assert.equal(detectDefaultBranch(dir), "trunk");
});

test("not a git repo → null", () => {
  assert.equal(detectDefaultBranch(mkdtempSync(join(tmpdir(), "ctx-nogit-"))), null);
});
