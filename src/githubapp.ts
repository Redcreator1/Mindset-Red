import { createSign } from "node:crypto";

/**
 * GitHub App packaging: a manifest for one-click creation, plus a handler
 * that maps App webhook events (installation lifecycle) onto our tenant model.
 *
 * The manifest is served so a user can create the App from their account via
 * the GitHub "create from manifest" flow; the webhook events (installation,
 * installation_repositories, push) are handled by the same signed endpoint as
 * the plain repo webhooks (see server.ts) — this module only classifies them.
 *
 * Reading a tenant's *private* repos in hosted mode needs a short-lived
 * installation access token (GitHub Apps can't use a personal token). Minting
 * one is a two-step dance: sign a 10-minute App JWT with the App's private
 * key, then exchange it for an installation token scoped to just that
 * installation's repos. Zero dependencies beyond node:crypto for the RS256
 * signature — server-side only (not used by the Cloudflare Worker, which
 * stays out of the repo-reading business entirely).
 */

export interface AppManifest {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  public: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
}

/** Build a GitHub App manifest pointing webhooks at `baseUrl`. */
export function buildAppManifest(baseUrl: string, appName = "mindset-ctx"): AppManifest {
  const url = baseUrl.replace(/\/+$/, "");
  return {
    name: appName,
    url: "https://github.com/Redcreator1/Mindset-Red",
    hook_attributes: { url: `${url}/v1/app/webhook`, active: true },
    redirect_url: `${url}/v1/app/installed`,
    public: true,
    // Least privilege: read code + metadata to generate context; read issues
    // and PRs to feed the memory layer. No write access.
    default_permissions: {
      contents: "read",
      metadata: "read",
      issues: "read",
      pull_requests: "read",
    },
    default_events: ["push", "issues", "pull_request", "installation", "installation_repositories"],
  };
}

export interface AppInstallationEvent {
  action?: string;
  installation?: {
    id: number;
    account?: { login?: string };
  };
  repositories?: { full_name: string }[];
  repositories_added?: { full_name: string }[];
  repositories_removed?: { full_name: string }[];
}

export type AppEventOutcome =
  | { kind: "installed"; installationId: number; account: string; repos: string[] }
  | { kind: "uninstalled"; installationId: number; account: string }
  | { kind: "repos-added"; installationId: number; account: string; repos: string[] }
  | { kind: "repos-removed"; installationId: number; account: string; repos: string[] }
  | { kind: "ignored"; reason: string };

/**
 * Classify an `installation` / `installation_repositories` webhook payload
 * into a lifecycle outcome the server can act on (provision/deprovision a
 * tenant, add/remove repos from its scope).
 */
export function classifyAppEvent(event: string, payload: AppInstallationEvent): AppEventOutcome {
  const installationId = payload.installation?.id;
  const account = payload.installation?.account?.login ?? "unknown";
  if (!installationId) return { kind: "ignored", reason: "no installation id" };

  if (event === "installation") {
    switch (payload.action) {
      case "created":
        return {
          kind: "installed",
          installationId,
          account,
          repos: (payload.repositories ?? []).map((r) => r.full_name),
        };
      case "deleted":
        return { kind: "uninstalled", installationId, account };
      default:
        return { kind: "ignored", reason: `installation action '${payload.action}' not handled` };
    }
  }

  if (event === "installation_repositories") {
    if (payload.repositories_added?.length) {
      return { kind: "repos-added", installationId, account, repos: payload.repositories_added.map((r) => r.full_name) };
    }
    if (payload.repositories_removed?.length) {
      return { kind: "repos-removed", installationId, account, repos: payload.repositories_removed.map((r) => r.full_name) };
    }
    return { kind: "ignored", reason: "no repositories added or removed" };
  }

  return { kind: "ignored", reason: `event '${event}' is not an app lifecycle event` };
}

/** Small helper reused by the CLI to print install instructions. */
export function installUrlHint(baseUrl: string): string {
  const url = baseUrl.replace(/\/+$/, "");
  return `Create the App from manifest: POST the manifest at ${url}/v1/app/manifest to https://github.com/settings/apps/new`;
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/**
 * Sign a GitHub App JWT (RS256), valid for 10 minutes — GitHub's maximum.
 * `iat` is backdated 60s to tolerate clock drift between us and GitHub, per
 * GitHub's own guidance.
 */
export function mintAppJwt(appId: string, privateKeyPem: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60;
  const exp = iat + 600;
  const signingInput = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iat, exp, iss: appId }))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem).toString("base64url");
  return `${signingInput}.${signature}`;
}

export interface InstallationToken {
  token: string;
  /** ISO 8601 expiry — installation tokens are valid for 1 hour. */
  expiresAt: string;
}

/**
 * Exchange the App's credentials for a short-lived token scoped to one
 * installation — this is what actually unlocks reading that installation's
 * private repos (via `git clone` with `x-access-token:<token>@…`, or the
 * GitHub API).
 */
export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
  baseUrl = "https://api.github.com",
): Promise<InstallationToken> {
  const jwt = mintAppJwt(appId, privateKeyPem);
  const url = `${baseUrl.replace(/\/+$/, "")}/app/installations/${installationId}/access_tokens`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json", "user-agent": "mindset-ctx" },
  });
  if (!res.ok) throw new Error(`GitHub POST /app/installations/${installationId}/access_tokens → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { token: string; expires_at: string };
  return { token: body.token, expiresAt: body.expires_at };
}

