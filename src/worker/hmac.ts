/**
 * Cloudflare Workers signature verification — Web Crypto only.
 *
 * The Node code in billing.ts uses `node:crypto` which doesn't exist in the
 * Workers runtime. These are the Workers-native equivalents, semantically
 * identical: HMAC-SHA256, hex compare, constant-time.
 */

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time hex string equality. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Stripe webhook signature (`t=…,v1=…`).
 * Rejects timestamps older than `toleranceSec` to block replay.
 */
export async function verifyStripeSignatureWeb(
  payload: string,
  header: string | null,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v];
    }),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSec) return false;

  const expected = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return timingSafeEqualHex(signature, expected);
}

/** Verify a GitHub webhook signature (`X-Hub-Signature-256: sha256=…`). */
export async function verifyGithubSignatureWeb(
  payload: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const expected = await hmacSha256Hex(secret, payload);
  return timingSafeEqualHex(header.slice("sha256=".length), expected);
}

const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days — mirrors session.ts's SESSION_TTL_SEC

/** Mint a signed SSO session token: "<tenantKey>.<expiry>.<hmac>" (Web Crypto). */
export async function mintSessionTokenWeb(tenantKey: string, secret: string, now = Date.now()): Promise<string> {
  const expiry = Math.floor(now / 1000) + SESSION_TTL_SEC;
  const sig = await hmacSha256Hex(secret, `${tenantKey}.${expiry}`);
  return `${tenantKey}.${expiry}.${sig}`;
}

/** Verify a signed SSO session token, returning the tenant key if valid and unexpired. */
export async function verifySessionTokenWeb(token: string | undefined, secret: string): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [key, expiryStr, sig] = parts;
  const expiry = Number(expiryStr);
  if (!expiry || Math.floor(Date.now() / 1000) > expiry) return null;
  const expected = await hmacSha256Hex(secret, `${key}.${expiry}`);
  return timingSafeEqualHex(sig, expected) ? key : null;
}
