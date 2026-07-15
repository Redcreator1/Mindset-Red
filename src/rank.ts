import type { HybridResult } from "./hybrid.js";

/**
 * Rank — the "Moat" brick from docs/VISION.md's Phase 4: a proprietary
 * re-ranking layer on top of RRF-fused hybrid search, not a large LLM.
 *
 * Honest scope: this is v0 — a small, explainable linear reranker over
 * hand-engineered features (retrieval agreement, title match, recency).
 * Weights are hand-tuned, not learned. Turning it into a genuinely trained
 * model needs a labeled-relevance dataset (real query/click or thumbs-up
 * feedback from actual usage) plus training compute — a data-collection
 * pipeline and a budget line, neither of which exists yet. What's built
 * here is the real, tested, useful part buildable today: the scoring
 * interface and a reranker that measurably improves on plain RRF. The
 * weights are deliberately the one piece meant to be swapped out later,
 * once there's feedback data to learn them from instead of guessing them.
 */

export interface RankWeights {
  /** Weight on the underlying RRF fusion score (the baseline signal). */
  rrf: number;
  /** Weight on the fraction of query terms found in the record's title. */
  titleMatch: number;
  /** Weight on an exponential recency decay (half-life ~1 year). */
  recency: number;
  /** Flat bonus when both the lexical and semantic retrievers agree on a record. */
  bothRetrievers: number;
}

/**
 * Hand-tuned starting point, not fit to data. Rationale for each: rrf=1
 * keeps the proven RRF ordering as the dominant signal; titleMatch=0.15 is
 * enough to break ties in favor of records whose title literally names what
 * was searched, without overriding strong RRF agreement; recency=0.05 is a
 * small nudge (old-but-relevant should still usually win over new-but-vague);
 * bothRetrievers=0.08 rewards genuine lexical+semantic agreement over a
 * record only one retriever liked.
 */
export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  rrf: 1,
  titleMatch: 0.15,
  recency: 0.05,
  bothRetrievers: 0.08,
};

/** Fraction (0..1) of the query's terms that appear in the title, case-insensitive. */
function titleMatchScore(title: string, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const t = title.toLowerCase();
  const hits = terms.filter((term) => t.includes(term)).length;
  return hits / terms.length;
}

/** Exponential decay in [0,1] by age; unparseable dates score 0 (neutral, not penalized beyond that). */
function recencyScore(dateStr: string, nowMs: number): number {
  const date = Date.parse(dateStr);
  if (Number.isNaN(date)) return 0;
  const ageDays = Math.max(0, (nowMs - date) / 86_400_000);
  return Math.exp(-ageDays / 365);
}

/** Score a single fused result against the query. Higher is better, same direction as HybridResult.score. */
export function rankScore(
  result: HybridResult,
  query: string,
  weights: RankWeights = DEFAULT_RANK_WEIGHTS,
  nowMs: number = Date.now(),
): number {
  const bothAgree = result.lexicalRank !== null && result.semanticRank !== null ? 1 : 0;
  return (
    weights.rrf * result.score +
    weights.titleMatch * titleMatchScore(result.record.title, query) +
    weights.recency * recencyScore(result.record.date, nowMs) +
    weights.bothRetrievers * bothAgree
  );
}

/** Re-sort RRF-fused results by the Rank score. Returns a new array; each result's `.score` becomes the rank score. */
export function rerank(
  results: HybridResult[],
  query: string,
  weights: RankWeights = DEFAULT_RANK_WEIGHTS,
  nowMs: number = Date.now(),
): HybridResult[] {
  return results
    .map((r) => ({ ...r, score: rankScore(r, query, weights, nowMs) }))
    .sort((a, b) => b.score - a.score);
}
