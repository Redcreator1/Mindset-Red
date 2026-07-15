import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { HybridResult } from "./hybrid.js";

/**
 * Rank ML — the v1 successor to the hand-tuned Rank v0 (rank.ts): a real
 * pretrained cross-encoder, run locally, blended with the existing RRF/v0
 * score rather than replacing it outright.
 *
 * Deliberately Node-only. Our hosted production runtime is Cloudflare
 * Workers, which has no GPU and tight CPU-time limits — running neural net
 * inference there would need Workers AI or an external hosted endpoint,
 * both billed. This module is wired into src/server.ts only; the Worker
 * (src/worker/index.ts) keeps using rank.ts's heuristic reranker. That is a
 * deliberate, cost-driven parity gap — see docs/VISION.md.
 *
 * Model provenance: this does NOT invent or fabricate a trained model.
 * `notebooks/train_rank_ml.py` fine-tunes a real pretrained MS MARCO
 * cross-encoder on a free Colab T4 GPU and exports ONNX + tokenizer files.
 * loadMlReranker() below reads those files from a local directory —
 * `CTX_RANK_ML_MODEL_DIR` — and NEVER fetches anything from a network at
 * request time. Until that directory exists, getMlReranker() returns null
 * and callers fall back to Rank v0, never crashing the request.
 *
 * Honesty about what's verified in this repo: the blending logic below
 * (mlRerank) is unit-tested against a stubbed MlReranker, so its math is
 * real and checked. The @xenova/transformers wiring in getMlReranker() calls
 * AutoTokenizer + AutoModelForSequenceClassification directly (not the
 * high-level `pipeline()` helper, whose text-classification pipeline only
 * types a bare string/string[], not a query/passage pair) — that call shape
 * was checked against the library's actual shipped .d.ts files (pulled via
 * `npm pack`, since a full `npm install` of this package failed in the
 * environment this was written in — see below). It still could not be
 * exercised end-to-end there: huggingface.co is unreachable from that
 * sandbox, so no real model files were ever available to load. Verify it
 * yourself once you've run the Colab notebook and pointed
 * CTX_RANK_ML_MODEL_DIR at the exported directory.
 */

export interface MlReranker {
  /** Relevance score for one (query, passage) pair. Higher = more relevant. Not assumed to be in [0,1]. */
  score(query: string, passage: string): Promise<number>;
}

let cached: { modelDir: string; reranker: MlReranker } | null = null;

/**
 * Load (and cache) a cross-encoder reranker from a local model directory
 * exported by notebooks/train_rank_ml.py. Returns null — never throws — if
 * the directory doesn't exist or the pipeline fails to load, so this is
 * always safe to call speculatively.
 */
export async function getMlReranker(modelDir: string | undefined): Promise<MlReranker | null> {
  if (!modelDir || !existsSync(modelDir)) return null;
  if (cached?.modelDir === modelDir) return cached.reranker;

  try {
    // @xenova/transformers is an optionalDependency (package.json) — its
    // install can fail on platforms that can't fetch its native onnxruntime/
    // sharp binaries, so its types aren't always resolvable. Falling back to
    // Rank v0 in the catch below is the point of that optionality.
    // @ts-ignore
    const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import("@xenova/transformers");
    // Local files only — never fetch from the HuggingFace hub at request
    // time. See the module doc comment for why this matters here.
    env.allowRemoteModels = false;
    env.localModelPath = dirname(modelDir);
    const modelName = basename(modelDir);
    const tokenizer = await AutoTokenizer.from_pretrained(modelName);
    const model = await AutoModelForSequenceClassification.from_pretrained(modelName);

    // No high-level `pipeline("text-classification")` here — its typed
    // signature only accepts a bare string or string[], not a (query,
    // passage) pair. Cross-encoder pair scoring needs the tokenizer's own
    // `text_pair` option instead, feeding straight into the model. Verified
    // against @xenova/transformers 2.17.2's shipped .d.ts files (fetched via
    // `npm pack`, since neither `npm install` for this package nor
    // huggingface.co were reachable to test any of this end-to-end where
    // this was written — see the module doc comment).
    const reranker: MlReranker = {
      async score(query, passage) {
        const inputs = await tokenizer(query, { text_pair: passage, truncation: true });
        const { logits } = await model(inputs);
        // MS MARCO cross-encoders use num_labels=1 (a regression-style
        // relevance score, not a softmax over classes) — the single logit
        // *is* the score, no argmax/softmax needed.
        return Number(logits.data[0]) || 0;
      },
    };
    cached = { modelDir, reranker };
    return reranker;
  } catch (err) {
    console.error("rank-ml: failed to load model — falling back to Rank v0:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Reset the module-level cache — for tests only, so they don't leak state across each other. */
export function resetMlRerankerCache(): void {
  cached = null;
}

/**
 * Blend each result's existing (RRF/v0) score with a cross-encoder
 * relevance score. `blendWeight` is how much of the final score comes from
 * the ML model (0 = ignore it entirely, 1 = ML score only). Any single
 * scoring failure falls back to that result's original score rather than
 * failing the whole rerank.
 */
export async function mlRerank(
  results: HybridResult[],
  query: string,
  reranker: MlReranker,
  blendWeight = 0.5,
): Promise<HybridResult[]> {
  const scored = await Promise.all(
    results.map(async (r) => {
      try {
        const mlScore = await reranker.score(query, `${r.record.title} ${r.record.body}`.slice(0, 512));
        return { ...r, score: blendWeight * mlScore + (1 - blendWeight) * r.score };
      } catch {
        return r;
      }
    }),
  );
  return scored.sort((a, b) => b.score - a.score);
}
