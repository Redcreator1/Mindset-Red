import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContextServer } from "../server.js";
import { TenantStore } from "../tenants.js";
import { indexCommits, writeMemory } from "../memory.js";
import { buildWorkosAuthorizationUrl } from "../workos.js";

function makeRepo(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ctx-${name}-`));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  const env = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t.t" };
  execFileSync("git", ["-C", dir, "init", "-q"], { env });
  execFileSync("git", ["-C", dir, "add", "."], { env });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", `feat: ${name}`], { env });
  writeMemory(dir, indexCommits(dir));
  return dir;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, r));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

/** Fakes WorkOS's /user_management/authenticate: each registered code resolves to a fixed identity, one-time use like a real auth code. */
function startWorkosMock(): Promise<{ baseURL: string; server: Server; registerCode: (code: string, identity: { id: string; email: string; organization_id?: string }) => void }> {
  const codes = new Map<string, { id: string; email: string; organization_id?: string }>();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, obj: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "POST" && url.pathname === "/user_management/authenticate") {
      const parsed = JSON.parse(body) as { code: string };
      const identity = codes.get(parsed.code);
      if (!identity) return send(400, { error: "invalid_grant" });
      codes.delete(parsed.code); // one-time use, like a real auth code
      return send(200, { user: { id: identity.id, email: identity.email }, organization_id: identity.organization_id });
    }
    send(404, { error: `mock: unhandled ${req.method} ${url.pathname}` });
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        baseURL: `http://127.0.0.1:${port}`,
        server,
        registerCode: (code, identity) => codes.set(code, identity),
      });
    });
  });
}

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "response set a cookie");
  return setCookie!.split(";")[0];
}

test("buildWorkosAuthorizationUrl points at AuthKit with the right client/redirect/org params", () => {
  const url = new URL(buildWorkosAuthorizationUrl({
    clientId: "client_123", redirectUri: "https://ctx.example.com/v1/sso/callback", organizationId: "org_abc",
  }));
  assert.equal(url.origin + url.pathname, "https://api.workos.com/user_management/authorize");
  assert.equal(url.searchParams.get("client_id"), "client_123");
  assert.equal(url.searchParams.get("redirect_uri"), "https://ctx.example.com/v1/sso/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("provider"), "authkit");
  assert.equal(url.searchParams.get("organization_id"), "org_abc");
});

test("/v1/sso/login redirects to WorkOS AuthKit; 503 when SSO isn't configured", async () => {
  const repo = makeRepo("sso-login");
  const unconfigured = createContextServer({ "sso-login": repo }, { tenantStore: new TenantStore([]) });
  const base1 = await listen(unconfigured);
  try {
    const res = await fetch(`${base1}/v1/sso/login`, { redirect: "manual" });
    assert.equal(res.status, 503);
  } finally {
    unconfigured.close();
  }

  const configured = createContextServer({ "sso-login": repo }, {
    tenantStore: new TenantStore([]), workosClientId: "client_123", workosApiKey: "sk_test_x", appBaseUrl: "https://ctx.example.com",
  });
  const base2 = await listen(configured);
  try {
    const res = await fetch(`${base2}/v1/sso/login?org=org_abc`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get("location")!);
    assert.equal(location.searchParams.get("redirect_uri"), "https://ctx.example.com/v1/sso/callback");
    assert.equal(location.searchParams.get("organization_id"), "org_abc");
  } finally {
    configured.close();
  }
});

test("SSO callback provisions an org+owner on first company login, a pooled member on the second, and a cookie-authenticated session for both", async () => {
  const workos = await startWorkosMock();
  const repo = makeRepo("sso-e2e");
  const store = new TenantStore([]);
  const server = createContextServer({ "sso-e2e": repo }, {
    tenantStore: store,
    appBaseUrl: "http://ctx.local",
    workosClientId: "client_123",
    workosApiKey: "sk_test_x",
    workosBaseURL: workos.baseURL,
  });
  const base = await listen(server);

  try {
    // 1. First employee of "acme" logs in via SSO — becomes the org's owner.
    workos.registerCode("code-alice", { id: "user_alice", email: "alice@acme.com", organization_id: "org_acme" });
    const first = await fetch(`${base}/v1/sso/callback?code=code-alice`, { redirect: "manual" });
    assert.equal(first.status, 302);
    assert.equal(first.headers.get("location"), "http://ctx.local/v1/dashboard");
    const aliceCookie = cookieFrom(first);

    const aliceTenant = store.findBySsoUserId("user_alice");
    assert.ok(aliceTenant, "SSO login auto-provisioned a tenant");
    assert.equal(aliceTenant!.role, "owner");
    assert.ok(aliceTenant!.orgId, "tenant is linked to an organization");
    const org = store.getOrg(aliceTenant!.orgId!);
    assert.equal(org?.ssoOrgId, "org_acme");

    // 2. A second employee of the same company logs in — joins the SAME org
    // as a member, not a fresh one, and shares its pooled quota.
    workos.registerCode("code-bob", { id: "user_bob", email: "bob@acme.com", organization_id: "org_acme" });
    const second = await fetch(`${base}/v1/sso/callback?code=code-bob`, { redirect: "manual" });
    assert.equal(second.status, 302);
    const bobCookie = cookieFrom(second);
    const bobTenant = store.findBySsoUserId("user_bob");
    assert.equal(bobTenant?.role, "member");
    assert.equal(bobTenant?.orgId, aliceTenant!.orgId, "same company → same organization, not a duplicate");

    // 3. Re-logging in as alice does NOT mint a second tenant.
    workos.registerCode("code-alice-again", { id: "user_alice", email: "alice@acme.com", organization_id: "org_acme" });
    await fetch(`${base}/v1/sso/callback?code=code-alice-again`, { redirect: "manual" });
    assert.equal(store.membersOf(aliceTenant!.orgId!).length, 2, "still just alice + bob, no duplicate tenant");

    // 4. The session cookie authenticates the dashboard exactly like a Bearer key would.
    const dash = await fetch(`${base}/v1/dashboard/data`, { headers: { cookie: aliceCookie } });
    assert.equal(dash.status, 200);
    const dashData = await dash.json() as { tenants: { name: string }[] };
    assert.deepEqual(dashData.tenants.map((t) => t.name).sort(), ["alice@acme.com", "bob@acme.com"]);

    // 5. Bob's cookie works too, but a tampered one is rejected.
    assert.equal((await fetch(`${base}/v1/usage`, { headers: { cookie: bobCookie } })).status, 200);
    const tamperedValue = bobCookie.split("=")[1].replace(/\.[a-f0-9]+$/, ".deadbeef");
    assert.equal((await fetch(`${base}/v1/usage`, { headers: { cookie: `ctx_session=${tamperedValue}` } })).status, 401);

    // 6. No cookie, no Bearer key → still 401 as before.
    assert.equal((await fetch(`${base}/v1/usage`)).status, 401);

    // 7. Logout clears the cookie.
    const logout = await fetch(`${base}/v1/sso/logout`, { redirect: "manual" });
    assert.equal(logout.status, 302);
    assert.match(logout.headers.get("set-cookie") ?? "", /ctx_session=;.*Max-Age=0/);
  } finally {
    server.close();
    workos.server.close();
  }
});

test("SSO login without a WorkOS organization (personal AuthKit account) provisions a plain solo tenant", async () => {
  const workos = await startWorkosMock();
  const repo = makeRepo("sso-solo");
  const store = new TenantStore([]);
  const server = createContextServer({ "sso-solo": repo }, {
    tenantStore: store, appBaseUrl: "http://ctx.local", workosClientId: "client_123", workosApiKey: "sk_test_x", workosBaseURL: workos.baseURL,
  });
  const base = await listen(server);
  try {
    workos.registerCode("code-solo", { id: "user_solo", email: "solo@example.com" });
    const res = await fetch(`${base}/v1/sso/callback?code=code-solo`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const tenant = store.findBySsoUserId("user_solo");
    assert.ok(tenant);
    assert.equal(tenant!.orgId, undefined);
    assert.equal(tenant!.plan, "free");
  } finally {
    server.close();
    workos.server.close();
  }
});

test("/v1/sso/callback: missing code is 400, WorkOS error is 502", async () => {
  const workos = await startWorkosMock();
  const repo = makeRepo("sso-errors");
  const server = createContextServer({ "sso-errors": repo }, {
    tenantStore: new TenantStore([]), workosClientId: "client_123", workosApiKey: "sk_test_x", workosBaseURL: workos.baseURL,
  });
  const base = await listen(server);
  try {
    assert.equal((await fetch(`${base}/v1/sso/callback`)).status, 400);
    assert.equal((await fetch(`${base}/v1/sso/callback?code=never-registered`)).status, 502);
  } finally {
    server.close();
    workos.server.close();
  }
});
