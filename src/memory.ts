import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MemoryRecord } from "./types.js";

export const MEMORY_PATH = ".context/memory.jsonl";

const FIELD_SEP = "\x1f"; // ASCII unit separator - never appears in commit text
const RECORD_SEP = "\x1e"; // ASCII record separator

/**
 * Index the git history of a repo into memory records.
 * v0 covers commits; PR/issue/discussion ingestion (GitHub API) is the next
 * milestone — the record schema already accommodates them.
 */
export function indexCommits(root: string, limit = 500): MemoryRecord[] {
  let raw: string;
  try {
    raw = execFileSync(
      "git",
      ["-C", root, "log", `-${limit}`, "--name-only", `--pretty=format:${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${FIELD_SEP}%b${FIELD_SEP}`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return [];
  }

  const records: MemoryRecord[] = [];
  for (const chunk of raw.split(RECORD_SEP)) {
    if (!chunk.trim()) continue;
    const parts = chunk.split(FIELD_SEP);
    if (parts.length < 6) continue;
    const [sha, author, date, subject, body, filesBlock] = parts;
    records.push({
      type: "commit",
      id: sha.trim(),
      title: subject.trim(),
      body: body.trim(),
      author: author.trim(),
      date: date.trim(),
      files: filesBlock.split("\n").map((f) => f.trim()).filter(Boolean),
    });
  }
  return records;
}

/** Write records to .context/memory.jsonl inside the repo. */
export function writeMemory(root: string, records: MemoryRecord[]): string {
  const path = join(root, MEMORY_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
  return path;
}

/** Load the memory file of a repo (empty array if absent). */
export function loadMemory(root: string): MemoryRecord[] {
  const path = join(root, MEMORY_PATH);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MemoryRecord);
}

/**
 * Merge two record sets, deduplicating on type+id. Incoming records win,
 * so a re-index refreshes stale entries in place.
 */
export function mergeRecords(existing: MemoryRecord[], incoming: MemoryRecord[]): MemoryRecord[] {
  const byKey = new Map<string, MemoryRecord>();
  for (const r of [...existing, ...incoming]) byKey.set(`${r.type}:${r.id}`, r);
  return [...byKey.values()];
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 1);
}

function recordText(r: MemoryRecord): string {
  // Title weighted 3x: a term in the title says more than one buried in a diff list.
  return `${r.title} ${r.title} ${r.title} ${r.body} ${r.author} ${r.files.join(" ")}`;
}

/**
 * BM25-ranked search over memory records (k1=1.5, b=0.75). A record matches
 * when at least one query term appears in its title, body, author or touched
 * files; results are ordered by relevance. Corpus sizes here (hundreds to a
 * few thousand records) don't need an inverted index — a linear scan is
 * instant and keeps the code dependency-free. Embedding-based retrieval can
 * later slot in behind this same signature.
 */
export function searchMemory(records: MemoryRecord[], query: string, limit = 20): MemoryRecord[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return records.slice(0, limit);

  const k1 = 1.5;
  const b = 0.75;
  const docs = records.map((r) => tokenize(recordText(r)));
  const n = docs.length;
  const avgLen = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(n, 1);

  const docFreq = new Map<string, number>();
  for (const term of terms) {
    docFreq.set(term, docs.reduce((df, d) => df + (d.includes(term) ? 1 : 0), 0));
  }

  const scored: { record: MemoryRecord; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    const termFreq = new Map<string, number>();
    for (const tok of docs[i]) termFreq.set(tok, (termFreq.get(tok) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const f = termFreq.get(term) ?? 0;
      if (f === 0) continue;
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (docs[i].length / avgLen))));
    }
    if (score > 0) scored.push({ record: records[i], score });
  }

  scored.sort((a, b2) => b2.score - a.score);
  return scored.slice(0, limit).map((s) => s.record);
}
