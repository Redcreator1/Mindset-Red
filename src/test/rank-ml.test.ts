import test from "node:test";
import assert from "node:assert/strict";
import { getMlReranker, mlRerank, resetMlRerankerCache, type MlReranker } from "../rank-ml.js";
import type { HybridResult } from "../hybrid.js";
import type { MemoryRecord } from "../types.js";

const mkRecord = (id: string, title: string, body = ""): MemoryRecord => ({
  type: "commit", id, title, body, author: "dev", date: "2026-01-01", files: [],
});

const mkResult = (id: string, title: string, score: number): HybridResult => ({
  record: mkRecord(id, title),
  score,
  lexicalRank: 1,
  semanticRank: null,
});

const stubReranker = (scores: Record<string, number>): MlReranker => ({
  async score(_query, passage) {
    for (const [needle, s] of Object.entries(scores)) if (passage.includes(needle)) return s;
    return 0;
  },
});

test("getMlReranker returns null (never throws) when the model directory doesn't exist", async () => {
  resetMlRerankerCache();
  const reranker = await getMlReranker("/nonexistent/path/to/a/model");
  assert.equal(reranker, null);
});

test("getMlReranker returns null when no path is configured", async () => {
  resetMlRerankerCache();
  assert.equal(await getMlReranker(undefined), null);
});

test("mlRerank re-sorts by the blended score, favoring the ML-preferred result", async () => {
  const results = [mkResult("1", "misc cleanup", 0.9), mkResult("2", "fix payment retry", 0.1)];
  const reranker = stubReranker({ "fix payment retry": 1, "misc cleanup": 0 });
  const reranked = await mlRerank(results, "payment retry", reranker, 1);
  assert.equal(reranked[0].record.id, "2", "pure ML weight (1) lets the ML score fully override the original ranking");
  assert.equal(reranked.length, 2);
});

test("mlRerank with blendWeight=0 leaves the original ordering untouched", async () => {
  const results = [mkResult("1", "misc cleanup", 0.9), mkResult("2", "fix payment retry", 0.1)];
  const reranker = stubReranker({ "fix payment retry": 1, "misc cleanup": 0 });
  const reranked = await mlRerank(results, "payment retry", reranker, 0);
  assert.equal(reranked[0].record.id, "1", "blendWeight=0 ignores the ML score entirely");
});

test("mlRerank never drops or duplicates a result, even under a mixed blend", async () => {
  const results = [mkResult("1", "a", 0), mkResult("2", "b", 0), mkResult("3", "c", 0)].map((r, i) => ({ ...r, score: 0.1 * (i + 1) }));
  const reranker = stubReranker({});
  const reranked = await mlRerank(results, "x", reranker, 0.5);
  assert.deepEqual(new Set(reranked.map((r) => r.record.id)), new Set(["1", "2", "3"]));
});

test("mlRerank falls back to a result's original score if the reranker throws on it", async () => {
  const results = [mkResult("1", "ok", 0.5), mkResult("2", "boom", 0.3)];
  const flaky: MlReranker = {
    async score(_q, passage) {
      if (passage.includes("boom")) throw new Error("inference failed");
      return 1;
    },
  };
  const reranked = await mlRerank(results, "x", flaky, 1);
  assert.equal(reranked.length, 2);
  assert.ok(reranked.some((r) => r.record.id === "2" && r.score === 0.3), "failed scoring keeps the original score, not a crash");
});
