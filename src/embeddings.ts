import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MemoryRecord } from "./types.js";

/**
 * Semantic retrieval for the memory layer, via the Voyage AI embeddings API
 * (Anthropic's embeddings partner). Opt-in: requires VOYAGE_API_KEY.
 * Vectors are cached in .context/embeddings.jsonl keyed by record type:id,
 * so re-indexing only embeds new or changed records.
 */

export const EMBEDDINGS_PATH = ".context/embeddings.jsonl";
const DEFAULT_MODEL = "voyage-3.5-lite";
const BATCH_SIZE = 96;

export interface EmbeddingOptions {
  /** Override for tests / proxies. Default: https://api.voyageai.com */
  baseURL?: string;
  /** Falls back to VOYAGE_API_KEY. */
  apiKey?: string;
  model?: string;
}

export function hasEmbeddingKey(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

function recordKey(r: MemoryRecord): string {
  return `${r.type}:${r.id}`;
}

function recordText(r: MemoryRecord): string {
  return `${r.title}\n${r.body}`.slice(0, 4000);
}

/** Embed a batch of texts through the Voyage REST API. */
export async function embedTexts(texts: string[], opts: EmbeddingOptions = {}): Promise<number[][]> {
  const baseURL = (opts.baseURL ?? "https://api.voyageai.com").replace(/\/+$/, "");
  const apiKey = opts.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY is required for embeddings");

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const res = await fetch(`${baseURL}/v1/embeddings`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model ?? DEFAULT_MODEL, input: texts.slice(i, i + BATCH_SIZE) }),
    });
    if (!res.ok) throw new Error(`Voyage API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const payload = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    const batch = [...payload.data].sort((a, b) => a.index - b.index);
    vectors.push(...batch.map((d) => d.embedding));
  }
  return vectors;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function loadVectors(root: string): Map<string, number[]> {
  const path = join(root, EMBEDDINGS_PATH);
  const map = new Map<string, number[]>();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const { key, vector } = JSON.parse(line) as { key: string; vector: number[] };
    map.set(key, vector);
  }
  return map;
}

/**
 * Ensure every memory record has a cached vector; embeds only the missing
 * ones. Returns the number of newly embedded records.
 */
export async function indexEmbeddings(root: string, records: MemoryRecord[], opts: EmbeddingOptions = {}): Promise<number> {
  const vectors = loadVectors(root);
  const missing = records.filter((r) => !vectors.has(recordKey(r)));
  if (missing.length > 0) {
    const embedded = await embedTexts(missing.map(recordText), opts);
    missing.forEach((r, i) => vectors.set(recordKey(r), embedded[i]));
  }
  const path = join(root, EMBEDDINGS_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const keep = new Set(records.map(recordKey));
  const lines = [...vectors.entries()]
    .filter(([key]) => keep.has(key))
    .map(([key, vector]) => JSON.stringify({ key, vector }));
  writeFileSync(path, lines.join("\n") + (lines.length ? "\n" : ""));
  return missing.length;
}

/**
 * Rank records by cosine similarity to a query vector. Records without a
 * cached vector are skipped. Same signature philosophy as searchMemory —
 * lexical (BM25) and semantic ranking are interchangeable retrievers.
 */
export function rankBySimilarity(
  records: MemoryRecord[],
  vectors: Map<string, number[]>,
  queryVector: number[],
  limit = 20,
): MemoryRecord[] {
  return records
    .map((record) => ({ record, vector: vectors.get(recordKey(record)) }))
    .filter((x): x is { record: MemoryRecord; vector: number[] } => Boolean(x.vector))
    .map(({ record, vector }) => ({ record, score: cosineSimilarity(queryVector, vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.record);
}

/** Full semantic search: embed the query, rank the corpus. */
export async function semanticSearch(
  root: string,
  records: MemoryRecord[],
  query: string,
  limit = 20,
  opts: EmbeddingOptions = {},
): Promise<MemoryRecord[]> {
  const vectors = loadVectors(root);
  if (vectors.size === 0) throw new Error("No embeddings indexed — run `ctx index --embed` first");
  const [queryVector] = await embedTexts([query], opts);
  return rankBySimilarity(records, vectors, queryVector, limit);
}
