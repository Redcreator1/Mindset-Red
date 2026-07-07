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

/**
 * Keyword search over memory records. Every whitespace-separated term must
 * match (AND semantics) against title, body, author or touched files.
 * Simple on purpose: embeddings/BM25 come later behind the same signature.
 */
export function searchMemory(records: MemoryRecord[], query: string, limit = 20): MemoryRecord[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return records.slice(0, limit);
  const hits = records.filter((r) => {
    const haystack = `${r.title}\n${r.body}\n${r.author}\n${r.files.join("\n")}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
  return hits.slice(0, limit);
}
