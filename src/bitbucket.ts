import type { MemoryRecord } from "./types.js";

/**
 * Bitbucket Cloud ingestion for the memory layer: pulls pull requests and
 * (when the issue tracker is enabled) issues through the REST API v2.0 and
 * maps them onto MemoryRecord — the Bitbucket counterpart to github.ts /
 * gitlab.ts. Same zero-dependency, plain-fetch shape.
 *
 * Scope note: this covers memory ingestion only. Bitbucket Cloud has no
 * built-in HMAC/shared-token webhook signing comparable to GitHub's
 * X-Hub-Signature-256 or GitLab's X-Gitlab-Token — real-time webhook parity
 * needs its actual current security model verified against Bitbucket's own
 * docs before being wired into server.ts, rather than guessed at.
 */

export interface BitbucketIngestOptions {
  /** Override for tests / Bitbucket Server. Default: https://api.bitbucket.org/2.0 */
  baseUrl?: string;
  /** Token; falls back to BITBUCKET_TOKEN env var. */
  token?: string;
  /** Max records to return. Default 200. */
  limit?: number;
}

/** Extract workspace/repo_slug from an https or ssh Bitbucket remote URL. */
export function parseBitbucketRepoFromRemote(remote: string | null): { owner: string; repo: string } | null {
  if (!remote) return null;
  const m = remote.match(/bitbucket\.org[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function headers(token: string | undefined): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

interface BitbucketPullRequest {
  id: number;
  title?: string;
  description?: string | null;
  author?: { display_name?: string } | null;
  created_on?: string;
  updated_on?: string;
}

interface BitbucketIssue {
  id: number;
  title?: string;
  content?: { raw?: string | null } | null;
  reporter?: { display_name?: string } | null;
  created_on?: string;
  updated_on?: string;
}

interface BitbucketPage<T> {
  values?: T[];
}

async function fetchPaginated<T>(url: string, token: string | undefined, limit: number): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; items.length < limit; page++) {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}pagelen=100&page=${page}`, {
      headers: headers(token),
    });
    if (res.status === 404) break; // e.g. issue tracker disabled on this repo
    if (!res.ok) throw new Error(`Bitbucket API ${res.status} for ${url}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as BitbucketPage<T>;
    const batch = body.values ?? [];
    if (batch.length === 0) break;
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items.slice(0, limit);
}

function prToRecord(pr: BitbucketPullRequest): MemoryRecord {
  return {
    type: "pr",
    id: String(pr.id),
    title: pr.title ?? "",
    body: (pr.description ?? "").slice(0, 4000),
    author: pr.author?.display_name ?? "",
    date: pr.updated_on ?? pr.created_on ?? "",
    files: [],
  };
}

function issueToRecord(issue: BitbucketIssue): MemoryRecord {
  return {
    type: "issue",
    id: String(issue.id),
    title: issue.title ?? "",
    body: (issue.content?.raw ?? "").slice(0, 4000),
    author: issue.reporter?.display_name ?? "",
    date: issue.updated_on ?? issue.created_on ?? "",
    files: [],
  };
}

/**
 * Fetch pull requests (always) and issues (when the tracker is enabled) of a
 * Bitbucket Cloud repo as memory records. `state=ALL` is required — the
 * default PR/issue list only returns open ones.
 */
export async function fetchBitbucketMemory(
  owner: string,
  repo: string,
  opts: BitbucketIngestOptions = {},
): Promise<MemoryRecord[]> {
  const baseUrl = (opts.baseUrl ?? "https://api.bitbucket.org/2.0").replace(/\/+$/, "");
  const token = opts.token ?? process.env.BITBUCKET_TOKEN;
  const limit = opts.limit ?? 200;
  const repoUrl = `${baseUrl}/repositories/${owner}/${repo}`;

  const prs = await fetchPaginated<BitbucketPullRequest>(`${repoUrl}/pullrequests?state=ALL`, token, limit);
  const records = prs.map(prToRecord);

  // The issue tracker is opt-in per repo; a disabled tracker 404s, tolerated
  // the same way github.ts tolerates discussions being off.
  const issues = await fetchPaginated<BitbucketIssue>(`${repoUrl}/issues`, token, limit);
  records.push(...issues.map(issueToRecord));

  return records.slice(0, limit);
}
