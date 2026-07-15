import test from "node:test";
import assert from "node:assert/strict";
import { rankScore, rerank, DEFAULT_RANK_WEIGHTS } from "../rank.js";
import type { HybridResult } from "../hybrid.js";
import type { MemoryRecord } from "../types.js";

const mkRecord = (id: string, title: string, date = "2026-01-01"): MemoryRecord => ({
  type: "commit", id, title, body: "", author: "dev", date, files: [],
});

const mkResult = (id: string, title: string, opts: Partial<HybridResult> & { date?: string } = {}): HybridResult => ({
  record: mkRecord(id, title, opts.date),
  score: opts.score ?? 0.5,
  lexicalRank: opts.lexicalRank ?? null,
  semanticRank: opts.semanticRank ?? null,
});

test("rankScore boosts a title that literally names the query over an equally RRF-scored one that doesn't", () => {
  const now = Date.parse("2026-06-01");
  const titled = mkResult("1", "fix payment retry bug", { score: 0.5 });
  const untitled = mkResult("2", "misc cleanup", { score: 0.5 });
  assert.ok(rankScore(titled, "payment retry", DEFAULT_RANK_WEIGHTS, now) > rankScore(untitled, "payment retry", DEFAULT_RANK_WEIGHTS, now));
});

test("rankScore favors recent records over old ones at equal RRF score", () => {
  const now = Date.parse("2026-06-01");
  const recent = mkResult("1", "x", { score: 0.5, date: "2026-05-25" });
  const old = mkResult("2", "x", { score: 0.5, date: "2020-01-01" });
  assert.ok(rankScore(recent, "x", DEFAULT_RANK_WEIGHTS, now) > rankScore(old, "x", DEFAULT_RANK_WEIGHTS, now));
});

test("rankScore gives a bonus when both retrievers agree, over a record only one retriever found", () => {
  const now = Date.parse("2026-06-01");
  const both = mkResult("1", "x", { score: 0.5, lexicalRank: 1, semanticRank: 1 });
  const one = mkResult("2", "x", { score: 0.5, lexicalRank: 1, semanticRank: null });
  assert.ok(rankScore(both, "x", DEFAULT_RANK_WEIGHTS, now) > rankScore(one, "x", DEFAULT_RANK_WEIGHTS, now));
});

test("rankScore never throws on an unparseable date — treated as neutral, not penalized further", () => {
  const now = Date.parse("2026-06-01");
  const weird = mkResult("1", "x", { score: 0.5, date: "not-a-date" });
  assert.equal(typeof rankScore(weird, "x", DEFAULT_RANK_WEIGHTS, now), "number");
});

test("rerank re-sorts and rewrites .score, but never drops or duplicates a result", () => {
  const results = [
    mkResult("1", "misc"),
    mkResult("2", "fix payment retry"),
    mkResult("3", "misc too"),
  ];
  const reranked = rerank(results, "payment retry");
  assert.equal(reranked.length, 3);
  assert.equal(reranked[0].record.id, "2", "title match wins the top spot");
  assert.deepEqual(new Set(reranked.map((r) => r.record.id)), new Set(["1", "2", "3"]));
});
