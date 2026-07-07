import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reciprocalRankFusion, hybridSearch } from "../hybrid.js";
import { indexEmbeddings } from "../embeddings.js";
import { scoreBM25 } from "../memory.js";
import type { MemoryRecord } from "../types.js";

const mk = (id: string, title: string, body = ""): MemoryRecord => ({
  type: "commit", id, title, body, author: "dev", date: "2026-01-01", files: [],
});

test("reciprocalRankFusion rewards records both retrievers agree on", () => {
  const a = mk("1", "a"), b = mk("2", "b"), c = mk("3", "c");
  // a: rank1 lexical, rank2 semantic → strong. b: rank2 lexical only. c: rank1 semantic only.
  const fused = reciprocalRankFusion([a, b], [c, a]);
  assert.equal(fused[0].record.id, "1", "record ranked well by BOTH wins");
  assert.equal(fused[0].lexicalRank, 1);
  assert.equal(fused[0].semanticRank, 2);
  // b and c each appear in only one list.
  const ids = fused.map((f) => f.record.id);
  assert.deepEqual([...ids].sort(), ["1", "2", "3"]);
});

test("reciprocalRankFusion dedupes on type:id and respects limit", () => {
  const recs = Array.from({ length: 5 }, (_, i) => mk(String(i), `t${i}`));
  const fused = reciprocalRankFusion(recs, [...recs].reverse(), 3);
  assert.equal(fused.length, 3);
  assert.equal(new Set(fused.map((f) => `${f.record.type}:${f.record.id}`)).size, 3);
});

test("scoreBM25 exposes descending scores", () => {
  const recs = [mk("1", "payment gateway retry"), mk("2", "readme update")];
  const scored = scoreBM25(recs, "payment retry");
  assert.ok(scored[0].score > 0);
  assert.equal(scored[0].record.id, "1");
});

// Deterministic mock Voyage: 3-dim keyword vector.
function fakeVector(text: string): number[] {
  return [text.includes("payment") ? 1 : 0, text.includes("login") ? 1 : 0, 0.01];
}
async function startMockVoyage() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { input } = JSON.parse(body) as { input: string[] };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: fakeVector(text) })) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  return { baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() };
}

test("hybridSearch fuses BM25 and embeddings when an index exists", async () => {
  const voyage = await startMockVoyage();
  const dir = mkdtempSync(join(tmpdir(), "ctx-hybrid-"));
  const records = [mk("1", "fix payment gateway"), mk("2", "fix login flow"), mk("3", "update docs")];
  const opts = { baseURL: voyage.baseURL, apiKey: "test" };
  try {
    await indexEmbeddings(dir, records, opts);
    const hits = await hybridSearch(dir, records, "payment", 3, opts);
    assert.equal(hits[0].record.id, "1", "payment record tops both signals");
    assert.ok(hits[0].lexicalRank !== null && hits[0].semanticRank !== null, "fused from both retrievers");
  } finally {
    voyage.close();
  }
});

test("hybridSearch degrades to lexical-only when no embeddings are indexed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ctx-hybrid-nofuse-"));
  const records = [mk("1", "fix payment gateway"), mk("2", "update docs")];
  const hits = await hybridSearch(dir, records, "payment", 5);
  assert.equal(hits[0].record.id, "1");
  assert.equal(hits[0].semanticRank, null, "no semantic signal without an index");
  assert.equal(hits[0].lexicalRank, 1);
});
