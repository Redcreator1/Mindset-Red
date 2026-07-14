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

export function parseCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function buildSessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}; Path=/`;
}

export function buildClearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;
}
