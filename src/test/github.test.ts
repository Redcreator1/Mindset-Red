import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchGitHubMemory, parseRepoFromRemote } from "../github.js";
import { mergeRecords } from "../memory.js";
import type { MemoryRecord } from "../types.js";

test("parseRepoFromRemote handles https, ssh and .git suffixes", () => {
  assert.deepEqual(parseRepoFromRemote("https://github.com/foo/bar.git"), { owner: "foo", repo: "bar" });
  assert.deepEqual(parseRepoFromRemote("https://github.com/foo/bar"), { owner: "foo", repo: "bar" });
  assert.deepEqual(parseRepoFromRemote("git@github.com:foo/bar.git"), { owner: "foo", repo: "bar" });
  assert.deepEqual(parseRepoFromRemote("git@github.com:my-org/my.repo"), { owner: "my-org", repo: "my.repo" });
  assert.equal(parseRepoFromRemote("https://gitlab.com/foo/bar"), null);
  assert.equal(parseRepoFromRemote(null), null);
});

test("fetchGitHubMemory maps issues, PRs and discussions onto memory records", async () => {
  const mock = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/repos/foo/bar/issues") {
      res.end(
        JSON.stringify([
          { number: 12, title: "Fix login crash", body: "Stack trace…", user: { login: "alice" }, updated_at: "2026-01-02T00:00:00Z" },
          { number: 13, title: "Add dark mode", body: null, user: { login: "bob" }, updated_at: "2026-01-03T00:00:00Z", pull_request: { url: "…" } },
        ]),
      );
    } else if (url.pathname === "/repos/foo/bar/discussions") {
      res.end(JSON.stringify([{ number: 1, title: "Roadmap ideas", body: "Let's discuss", user: { login: "carol" }, created_at: "2026-01-01T00:00:00Z" }]));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "Not Found" }));
    }
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const baseUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

  try {
    const records = await fetchGitHubMemory("foo", "bar", { baseUrl });
    assert.equal(records.length, 3);
    const issue = records.find((r) => r.id === "12");
    const pr = records.find((r) => r.id === "13");
    const discussion = records.find((r) => r.type === "discussion");
    assert.equal(issue?.type, "issue");
    assert.equal(issue?.author, "alice");
    assert.equal(pr?.type, "pr");
    assert.equal(pr?.body, "");
    assert.equal(discussion?.title, "Roadmap ideas");
  } finally {
    mock.close();
  }
});

test("fetchGitHubMemory tolerates disabled discussions (404)", async () => {
  const mock = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if ((req.url ?? "").startsWith("/repos/foo/bar/issues")) {
      res.end(JSON.stringify([{ number: 1, title: "Only issue", body: "", user: { login: "a" }, updated_at: "2026-01-01T00:00:00Z" }]));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "Not Found" }));
    }
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const baseUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  try {
    const records = await fetchGitHubMemory("foo", "bar", { baseUrl });
    assert.equal(records.length, 1);
    assert.equal(records[0].type, "issue");
  } finally {
    mock.close();
  }
});

test("mergeRecords dedupes on type+id, incoming wins", () => {
  const a: MemoryRecord[] = [
    { type: "commit", id: "abc", title: "old", body: "", author: "", date: "", files: [] },
    { type: "issue", id: "1", title: "issue", body: "", author: "", date: "", files: [] },
  ];
  const b: MemoryRecord[] = [
    { type: "commit", id: "abc", title: "new", body: "", author: "", date: "", files: [] },
    { type: "pr", id: "1", title: "pr one", body: "", author: "", date: "", files: [] },
  ];
  const merged = mergeRecords(a, b);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((r) => r.type === "commit")?.title, "new");
  assert.ok(merged.some((r) => r.type === "issue" && r.id === "1"));
  assert.ok(merged.some((r) => r.type === "pr" && r.id === "1"));
});
