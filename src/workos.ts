/**
 * WorkOS AuthKit (SSO) integration — plain fetch, no SDK dependency, portable
 * to both the Node server and the Cloudflare Worker (same shape as
 * checkout.ts's Stripe calls and githubapp.ts's installation-token exchange).
 *
 * Flow: buildWorkosAuthorizationUrl() sends the browser to WorkOS's hosted
 * login; WorkOS redirects back with a one-time `code`; exchangeWorkosCode()
 * trades it for the authenticated user's identity (and, if they logged in
 * through a company's SSO connection, that company's WorkOS organization id
 * — used to pool them into the same mindset-ctx Organization as their
 * teammates rather than minting a fresh one per login).
 */

export interface WorkosUser {
  userId: string;
  email: string;
  organizationId?: string;
}

export function buildWorkosAuthorizationUrl(opts: {
  clientId: string;
  redirectUri: string;
  organizationId?: string;
  state?: string;
  baseURL?: string;
}): string {
  const base = (opts.baseURL ?? "https://api.workos.com").replace(/\/+$/, "");
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    provider: "authkit",
  });
  if (opts.organizationId) params.set("organization_id", opts.organizationId);
  if (opts.state) params.set("state", opts.state);
  return `${base}/user_management/authorize?${params.toString()}`;
}

/** Exchange the one-time authorization code for the logged-in user's identity. */
export async function exchangeWorkosCode(opts: {
  clientId: string;
  apiKey: string;
  code: string;
  baseURL?: string;
}): Promise<WorkosUser> {
  const base = (opts.baseURL ?? "https://api.workos.com").replace(/\/+$/, "");
  const res = await fetch(`${base}/user_management/authenticate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: opts.clientId,
      client_secret: opts.apiKey,
      grant_type: "authorization_code",
      code: opts.code,
    }),
  });
  if (!res.ok) {
    throw new Error(`WorkOS POST /user_management/authenticate → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as { user: { id: string; email: string }; organization_id?: string };
  return { userId: body.user.id, email: body.user.email, organizationId: body.organization_id };
}
