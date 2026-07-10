import type { MemoryRecord } from "./types.js";
import { scoreBM25 } from "./memory.js";
import { embedTexts, loadVectors, rankBySimilarity, type EmbeddingOptions } from "./embeddings.js";

/**
 * Hybrid retrieval: fuse the lexical (BM25) and semantic (embeddings) rankings
 * with Reciprocal Rank Fusion (RRF). RRF is rank-based, so it needs no score
 * normalization between the two very different score scales — each retriever
 * contributes 1/(k + rank) to a record's fused score. This reliably beats
 * either retriever alone: BM25 nails exact-term matches, embeddings catch
 * paraphrases, and RRF rewards records both agree on.
 *
 *   Cormack et al., "Reciprocal Rank Fusion outperforms Condorcet…" (2009)
 */

/** RRF dampening constant; 60 is the standard value from the literature. */
const RRF_K = 60;

export interface HybridResult {
  record: MemoryRecord;
  /** Fused RRF score (higher = better). */
  score: number;
  /** 1-based rank in the BM25 list, or null if absent. */
  lexicalRank: number | null;
  /** 1-based rank in the semantic list, or null if absent. */
  semanticRank: number | null;
}

function keyOf(r: MemoryRecord): string {
  return `${r.type}:${r.id}`;
}

/**
 * Fuse two ranked lists of records by RRF. Pure and synchronous so it can be
 * unit-tested without any network — the semantic ranking is passed in.
 */
export function reciprocalRankFusion(
  lexical: MemoryRecord[],
  semantic: MemoryRecord[],
  limit = 20,
  k = RRF_K,
): HybridResult[] {
  const lexicalRank = new Map<string, number>();
  lexical.forEach((r, i) => lexicalRank.set(keyOf(r), i + 1));
  const semanticRank = new Map<string, number>();
  semantic.forEach((r, i) => semanticRank.set(keyOf(r), i + 1));

  const byKey = new Map<string, MemoryRecord>();
  for (const r of [...lexical, ...semantic]) byKey.set(keyOf(r), r);

  const fused: HybridResult[] = [];
  for (const [key, record] of byKey) {
    const lr = lexicalRank.get(key) ?? null;
    const sr = semanticRank.get(key) ?? null;
    const score = (lr ? 1 / (k + lr) : 0) + (sr ? 1 / (k + sr) : 0);
    fused.push({ record, score, lexicalRank: lr, semanticRank: sr });
  }

  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, limit);
}

/**
 * Full hybrid search: run BM25 locally, embed the query and rank by cosine
 * against the cached vectors, then fuse. Falls back gracefully — if no
 * embeddings are indexed, returns pure BM25 so the endpoint never hard-fails.
 */
export async function hybridSearch(
  root: string,
  records: MemoryRecord[],
  query: string,
  limit = 20,
  opts: EmbeddingOptions = {},
): Promise<HybridResult[]> {
  const lexical = scoreBM25(records, query).map((s) => s.record);

  const vectors = loadVectors(root);
  if (vectors.size === 0) {
    // No semantic index — degrade to lexical-only, still shaped as HybridResult.
    return lexical.slice(0, limit).map((record, i) => ({
      record,
      score: 1 / (RRF_K + i + 1),
      lexicalRank: i + 1,
      semanticRank: null,
    }));
  }

  const [queryVector] = await embedTexts([query], opts);
  const semantic = rankBySimilarity(records, vectors, queryVector, records.length);
  return reciprocalRankFusion(lexical, semantic, limit);
}
