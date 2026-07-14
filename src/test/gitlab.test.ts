import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchGitLabMemory, parseGitLabRepoFromRemote } from "../gitlab.js";

test("parseGitLabRepoFromRemote handles https, ssh and .git suffixes", () => {
  assert.deepEqual(parseGitLabRepoFromRemote("https://gitlab.com/foo/bar.git"), { owner: "foo", repo: "bar" });
  assert.deepEqual(parseGitLabRepoFromRemote("https://gitlab.com/foo/bar"), { owner: "foo", repo: "bar" });
  assert.deepEqual(parseGitLabRepoFromRemote("git@gitlab.com:foo/bar.git"), { owner: "foo", repo: "bar" });
  assert.equal(parseGitLabRepoFromRemote("https://github.com/foo/bar"), null);
  assert.equal(parseGitLabRepoFromRemote(null), null);
});

test("fetchGitLabMemory maps issues and merge requests onto memory records", async () => {
  let capturedAuth: string | undefined;
  const mock = createServer((req, res) => {
    capturedAuth = req.headers["private-token"] as string | undefined;
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/projects/foo%2Fbar/issues") {
      res.end(
        JSON.stringify([
          { iid: 12, title: "Fix login crash", description: "Stack trace…", author: { username: "alice" }, updated_at: "2026-01-02T00:00:00Z" },
        ]),
      );
    } else if (url.pathname === "/projects/foo%2Fbar/merge_requests") {
      res.end(
        JSON.stringify([
          { iid: 7, title: "Add dark mode", description: null, author: { username: "bob" }, updated_at: "2026-01-03T00:00:00Z" },
        ]),
      );
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "Not Found" }));
    }
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const baseUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

  try {
    const records = await fetchGitLabMemory("foo", "bar", { baseUrl, token: "glpat-x" });
    assert.equal(records.length, 2);
    const issue = records.find((r) => r.id === "12");
    const mr = records.find((r) => r.id === "7");
    assert.equal(issue?.type, "issue");
    assert.equal(issue?.author, "alice");
    assert.equal(mr?.type, "pr");
    assert.equal(mr?.body, "");
    assert.equal(capturedAuth, "glpat-x", "token sent as PRIVATE-TOKEN header, not Bearer");
  } finally {
    mock.close();
  }
});

test("fetchGitLabMemory tolerates an empty project (no issues, no MRs)", async () => {
  const mock = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify([]));
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const baseUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  try {
    const records = await fetchGitLabMemory("foo", "bar", { baseUrl });
    assert.equal(records.length, 0);
  } finally {
    mock.close();
  }
});
