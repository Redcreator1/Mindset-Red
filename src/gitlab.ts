import type { MemoryRecord } from "./types.js";

/**
 * GitLab ingestion for the memory layer: pulls issues and merge requests
 * through the REST API (v4) and maps them onto MemoryRecord — the GitLab
 * counterpart to github.ts. Same zero-dependency, plain-fetch approach.
 *
 * Unlike GitHub's /issues (which mixes in PRs), GitLab keeps issues and
 * merge requests on separate endpoints, so both are fetched and merged here.
 */

export interface GitLabIngestOptions {
  /** Override for tests / self-hosted GitLab instances. Default: https://gitlab.com/api/v4 */
  baseUrl?: string;
  /** Token; falls back to GITLAB_TOKEN env var. */
  token?: string;
  /** Max records to return. Default 200. */
  limit?: number;
}

/** Extract owner/repo from a GitLab https or ssh remote URL. */
export function parseGitLabRepoFromRemote(remote: string | null): { owner: string; repo: string } | null {
  if (!remote) return null;
  const m = remote.match(/gitlab\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function headers(token: string | undefined): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (token) h["private-token"] = token;
  return h;
}

interface GitLabItem {
  iid: number;
  title?: string;
  description?: string | null;
  author?: { username?: string } | null;
  created_at?: string;
  updated_at?: string;
}

async function fetchPaginated(url: string, token: string | undefined, limit: number): Promise<GitLabItem[]> {
  const items: GitLabItem[] = [];
  for (let page = 1; items.length < limit; page++) {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`, {
      headers: headers(token),
    });
    if (!res.ok) throw new Error(`GitLab API ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
    const batch = (await res.json()) as GitLabItem[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items.slice(0, limit);
}

function toRecord(item: GitLabItem, type: MemoryRecord["type"]): MemoryRecord {
  return {
    type,
    id: String(item.iid),
    title: item.title ?? "",
    body: (item.description ?? "").slice(0, 4000),
    author: item.author?.username ?? "",
    date: item.updated_at ?? item.created_at ?? "",
    files: [],
  };
}

/** Fetch issues and merge requests of a GitLab project as memory records. */
export async function fetchGitLabMemory(
  owner: string,
  repo: string,
  opts: GitLabIngestOptions = {},
): Promise<MemoryRecord[]> {
  const baseUrl = (opts.baseUrl ?? "https://gitlab.com/api/v4").replace(/\/+$/, "");
  const token = opts.token ?? process.env.GITLAB_TOKEN;
  const limit = opts.limit ?? 200;
  const projectId = encodeURIComponent(`${owner}/${repo}`);
  const projectUrl = `${baseUrl}/projects/${projectId}`;

  const issues = await fetchPaginated(`${projectUrl}/issues?scope=all`, token, limit);
  const records = issues.map((it) => toRecord(it, "issue"));

  const mergeRequests = await fetchPaginated(`${projectUrl}/merge_requests?scope=all`, token, limit);
  records.push(...mergeRequests.map((mr) => toRecord(mr, "pr")));

  return records.slice(0, limit);
}
