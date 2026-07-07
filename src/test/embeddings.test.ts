import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cosineSimilarity, indexEmbeddings, loadVectors, rankBySimilarity, semanticSearch, EMBEDDINGS_PATH } from "../embeddings.js";
import type { MemoryRecord } from "../types.js";

const mk = (id: string, title: string): MemoryRecord => ({
  type: "commit", id, title, body: "", author: "dev", date: "2026-01-01", files: [],
});

/**
 * Mock Voyage API: deterministic "embeddings" — a 3-dim vector derived from
 * keyword presence, so similarity behaves predictably in assertions.
 */
function fakeVector(text: string): number[] {
  return [
    text.includes("payment") ? 1 : 0,
    text.includes("login") ? 1 : 0,
    text.includes("docs") ? 1 : 0.01,
  ];
}

async function startMockVoyage(): Promise<{ baseURL: string; close: () => void; calls: () => number }> {
  let calls = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls++;
      const { input } = JSON.parse(body) as { input: string[] };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: fakeVector(text) })) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  return {
    baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => server.close(),
    calls: () => calls,
  };
}

test("cosineSimilarity behaves geometrically", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0, "zero vector is not NaN");
});

test("indexEmbeddings caches vectors and only embeds missing records", async () => {
  const voyage = await startMockVoyage();
  const dir = mkdtempSync(join(tmpdir(), "ctx-embed-"));
  const records = [mk("1", "fix payment gateway"), mk("2", "fix login flow")];
  const opts = { baseURL: voyage.baseURL, apiKey: "test" };

  try {
    assert.equal(await indexEmbeddings(dir, records, opts), 2);
    assert.ok(existsSync(join(dir, EMBEDDINGS_PATH)));
    assert.equal(loadVectors(dir).size, 2);

    // Second run with one new record: only that one gets embedded.
    const withNew = [...records, mk("3", "update docs")];
    assert.equal(await indexEmbeddings(dir, withNew, opts), 1);
    assert.equal(loadVectors(dir).size, 3);

    // Records dropped from memory are pruned from the vector cache.
    assert.equal(await indexEmbeddings(dir, records, opts), 0);
    assert.equal(loadVectors(dir).size, 2);
  } finally {
    voyage.close();
  }
});

test("semanticSearch ranks by meaning-vector similarity", async () => {
  const voyage = await startMockVoyage();
  const dir = mkdtempSync(join(tmpdir(), "ctx-embed-search-"));
  const records = [mk("1", "fix payment gateway"), mk("2", "fix login flow"), mk("3", "update docs")];
  const opts = { baseURL: voyage.baseURL, apiKey: "test" };

  try {
    await indexEmbeddings(dir, records, opts);
    const hits = await semanticSearch(dir, records, "payment issue", 2, opts);
    assert.equal(hits[0].id, "1", "payment commit ranks first for a payment query");
    assert.equal(hits.length, 2);
  } finally {
    voyage.close();
  }
});

test("semanticSearch without an index fails with a helpful error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ctx-embed-empty-"));
  await assert.rejects(() => semanticSearch(dir, [], "q"), /ctx index --embed/);
});

test("rankBySimilarity skips records without vectors", () => {
  const vectors = new Map([["commit:1", [1, 0, 0]]]);
  const hits = rankBySimilarity([mk("1", "a"), mk("2", "b")], vectors, [1, 0, 0]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "1");
});
