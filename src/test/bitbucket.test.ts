import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchBitbucketMemory, parseBitbucketRepoFromRemote } from "../bitbucket.js";

test("parseBitbucketRepoFromRemote handles https, ssh and .git suffixes", () => {
  assert.deepEqual(parseBitbucketRepoFromRemote("https://bitbucket.org/foo/bar.git"), { owner: "foo", repo: "bar" });
  assert.deepEqual(parseBitbucketRepoFromRemote("https://bitbucket.org/foo/bar"), { owner: "foo", repo: "bar" });
  assert.deepEqual(parseBitbucketRepoFromRemote("git@bitbucket.org:foo/bar.git"), { owner: "foo", repo: "bar" });
  assert.equal(parseBitbucketRepoFromRemote("https://github.com/foo/bar"), null);
  assert.equal(parseBitbucketRepoFromRemote(null), null);
});

test("fetchBitbucketMemory maps pull requests and issues onto memory records", async () => {
  let capturedAuth: string | undefined;
  const mock = createServer((req, res) => {
    capturedAuth = req.headers.authorization;
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/repositories/foo/bar/pullrequests") {
      res.end(
        JSON.stringify({
          values: [
            { id: 7, title: "Add dark mode", description: "Details…", author: { display_name: "bob" }, updated_on: "2026-01-03T00:00:00Z" },
          ],
        }),
      );
    } else if (url.pathname === "/repositories/foo/bar/issues") {
      res.end(
        JSON.stringify({
          values: [
            { id: 12, title: "Fix login crash", content: { raw: "Stack trace…" }, reporter: { display_name: "alice" }, updated_on: "2026-01-02T00:00:00Z" },
          ],
        }),
      );
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "Not Found" } }));
    }
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const baseUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

  try {
    const records = await fetchBitbucketMemory("foo", "bar", { baseUrl, token: "bb-token" });
    assert.equal(records.length, 2);
    const pr = records.find((r) => r.id === "7");
    const issue = records.find((r) => r.id === "12");
    assert.equal(pr?.type, "pr");
    assert.equal(pr?.author, "bob");
    assert.equal(issue?.type, "issue");
    assert.equal(issue?.author, "alice");
    assert.equal(capturedAuth, "Bearer bb-token");
  } finally {
    mock.close();
  }
});

test("fetchBitbucketMemory tolerates a disabled issue tracker (404)", async () => {
  const mock = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/repositories/foo/bar/pullrequests") {
      res.end(JSON.stringify({ values: [{ id: 1, title: "Only PR", author: { display_name: "a" }, updated_on: "2026-01-01T00:00:00Z" }] }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "Not Found" } }));
    }
  });
  await new Promise<void>((r) => mock.listen(0, r));
  const baseUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  try {
    const records = await fetchBitbucketMemory("foo", "bar", { baseUrl });
    assert.equal(records.length, 1);
    assert.equal(records[0].type, "pr");
  } finally {
    mock.close();
  }
});
