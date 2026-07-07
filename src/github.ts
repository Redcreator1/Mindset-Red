import type { MemoryRecord } from "./types.js";

/**
 * GitHub ingestion for the memory layer: pulls PRs, issues and (when enabled)
 * discussions through the REST API and maps them onto MemoryRecord.
 * Zero dependencies — plain fetch. A token raises rate limits and unlocks
 * private repos but is optional for public ones.
 */

export interface GitHubIngestOptions {
  /** Override for tests / GitHub Enterprise. Default: https://api.github.com */
  baseUrl?: string;
  /** Token; falls back to GITHUB_TOKEN env var. */
  token?: string;
  /** Max records to return. Default 200. */
  limit?: number;
}

/** Extract owner/repo from an https or ssh git remote URL. */
export function parseRepoFromRemote(remote: string | null): { owner: string; repo: string } | null {
  if (!remote) return null;
  const m = remote.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function headers(token: string | undefined): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "mindset-ctx",
  };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

interface GitHubItem {
  number: number;
  title?: string;
  body?: string | null;
  user?: { login?: string } | null;
  created_at?: string;
  updated_at?: string;
  pull_request?: unknown;
}

async function fetchPaginated(url: string, token: string | undefined, limit: number): Promise<GitHubItem[]> {
  const items: GitHubItem[] = [];
  for (let page = 1; items.length < limit; page++) {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`, {
      headers: headers(token),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
    const batch = (await res.json()) as GitHubItem[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items.slice(0, limit);
}

function toRecord(item: GitHubItem, type: MemoryRecord["type"]): MemoryRecord {
  return {
    type,
    id: String(item.number),
    title: item.title ?? "",
    body: (item.body ?? "").slice(0, 4000),
    author: item.user?.login ?? "",
    date: item.updated_at ?? item.created_at ?? "",
    files: [],
  };
}

/**
 * Fetch PRs, issues and discussions of a repo as memory records.
 * Discussions 404 when the feature is disabled — silently skipped.
 */
export async function fetchGitHubMemory(
  owner: string,
  repo: string,
  opts: GitHubIngestOptions = {},
): Promise<MemoryRecord[]> {
  const baseUrl = (opts.baseUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const token = opts.token ?? process.env.GITHUB_TOKEN;
  const limit = opts.limit ?? 200;
  const repoUrl = `${baseUrl}/repos/${owner}/${repo}`;

  // /issues returns both issues and PRs; PRs carry a `pull_request` key.
  const issuesAndPrs = await fetchPaginated(`${repoUrl}/issues?state=all`, token, limit);
  const records = issuesAndPrs.map((it) => toRecord(it, it.pull_request ? "pr" : "issue"));

  try {
    const discussions = await fetchPaginated(`${repoUrl}/discussions`, token, limit);
    records.push(...discussions.map((d) => toRecord(d, "discussion")));
  } catch {
    // discussions disabled or API unavailable — commits/PRs/issues still indexed
  }

  return records.slice(0, limit);
}
