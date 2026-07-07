/** Shared types for the analyzer, generators, memory layer and API. */

export interface RepoAnalysis {
  /** Absolute path of the analyzed repository. */
  root: string;
  /** Repo name (from package manifest or directory name). */
  name: string;
  /** One-line description if one could be found. */
  description: string | null;
  /** Languages detected, ordered by file count (e.g. ["TypeScript", "CSS"]). */
  languages: LanguageStat[];
  /** Frameworks / notable tools detected (e.g. ["React", "Vite"]). */
  frameworks: string[];
  /** Package manifests found (package.json, pyproject.toml, Cargo.toml, ...). */
  manifests: string[];
  /** npm-style scripts if a package.json exists. */
  scripts: Record<string, string>;
  /** Direct dependencies (name only), across ecosystems when detectable. */
  dependencies: string[];
  /** Top-level directory layout with a short classification per entry. */
  layout: LayoutEntry[];
  /** Paths of existing docs (README, CONTRIBUTING, docs/...). */
  existingDocs: string[];
  /** True if a test setup was detected. */
  hasTests: boolean;
  /** True if CI config was detected (.github/workflows, etc.). */
  hasCI: boolean;
  /** git remote origin URL, if any. */
  remote: string | null;
  /** Default branch name, if resolvable. */
  defaultBranch: string | null;
  /** Total number of files scanned (excluding ignored dirs). */
  fileCount: number;
}

export interface LanguageStat {
  language: string;
  files: number;
}

export interface LayoutEntry {
  path: string;
  kind: "dir" | "file";
  note: string;
}

/** A single record in the memory layer (memory.jsonl). */
export interface MemoryRecord {
  /** Source of the record. PRs/issues/discussions arrive in later versions. */
  type: "commit" | "pr" | "issue" | "discussion";
  id: string;
  title: string;
  body: string;
  author: string;
  date: string;
  /** Files touched, when known (commits). */
  files: string[];
}
