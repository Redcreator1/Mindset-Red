/**
 * Browser session cookie plumbing for SSO login — pure string handling, no
 * crypto (that half is runtime-specific: node:crypto in server.ts's
 * mintSessionToken/verifySessionToken, Web Crypto in
 * worker/hmac.ts's mintSessionTokenWeb/verifySessionTokenWeb). Kept separate
 * so both runtimes share one cookie name/format/TTL instead of drifting.
 *
 * Token shape: "<tenantKey>.<expiryEpochSeconds>.<hmacHex>" — signed rather
 * than opaque, so verifying it needs no server-side session store (a KV
 * lookup per request would defeat the point of Workers' edge speed).
 */

export const SESSION_COOKIE = "ctx_session";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

/** Short-lived nonce tying an SSO login start to its callback (OAuth `state`). */
export const OAUTH_STATE_COOKIE = "ctx_oauth_state";
export const OAUTH_STATE_TTL_SEC = 60 * 10; // 10 minutes — one login round-trip

export function parseCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * SameSite=Strict: the session cookie is a credential, and several
 * authenticated routes mutate state on GET (/v1/team/invite, /v1/team/remove,
 * /v1/checkout) — Lax would attach it to cross-site top-level navigations,
 * letting a crafted link CSRF a logged-in owner. Strict never sends it
 * cross-site. The one flow that needs a cookie to survive a cross-site hop
 * (WorkOS redirecting back to /v1/sso/callback) uses the separate Lax state
 * cookie below, not this one.
 */
export function buildSessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SEC}; Path=/`;
}

export function buildClearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`;
}

/** Mint a fresh unguessable OAuth state nonce (Web Crypto — global on Node ≥20 and Workers). */
export function newOauthState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * SameSite=Lax on purpose (unlike the session cookie): WorkOS redirects the
 * browser back to /v1/sso/callback from its own domain — a cross-site
 * top-level GET — and the state cookie must ride along to be checked there.
 * Lax allows exactly that and nothing more; the cookie carries no authority
 * by itself (it's a nonce, not a credential) and dies after one round-trip.
 */
export function buildStateCookieHeader(state: string): string {
  return `${OAUTH_STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=${OAUTH_STATE_TTL_SEC}; Path=/`;
}

export function buildClearStateCookieHeader(): string {
  return `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;
}
