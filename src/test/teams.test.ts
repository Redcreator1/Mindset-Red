import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContextServer } from "../server.js";
import { TenantStore, UsageMeter, orgDailyLimit, orgPlan, tenantCanManageBilling, type Organization, type Tenant } from "../tenants.js";
import { indexCommits, writeMemory } from "../memory.js";

// ---------- pure helpers ----------

test("orgDailyLimit / orgPlan mirror tenantDailyLimit / tenantPlan for organizations", () => {
  const free: Organization = { id: "org-1", name: "acme", repos: "*" };
  const team: Organization = { id: "org-2", name: "acme", repos: "*", plan: "team" };
  const overridden: Organization = { id: "org-3", name: "acme", repos: "*", plan: "team", dailyLimit: 7 };
  assert.equal(orgDailyLimit(free), 200, "defaults to the free plan quota");
  assert.equal(orgDailyLimit(team), 50000);
  assert.equal(orgDailyLimit(overridden), 7, "explicit override beats the plan quota");
  assert.equal(orgPlan(team).id, "team");
});

test("tenantCanManageBilling: solo tenants always can, org members need the owner role", () => {
  const solo: Tenant = { key: "sk-solo", name: "solo", repos: "*" };
  const owner: Tenant = { key: "sk-owner", name: "owner", repos: "*", orgId: "org-1", role: "owner" };
  const member: Tenant = { key: "sk-member", name: "member", repos: "*", orgId: "org-1", role: "member" };
  assert.equal(tenantCanManageBilling(solo), true);
  assert.equal(tenantCanManageBilling(owner), true);
  assert.equal(tenantCanManageBilling(member), false);
});

// ---------- TenantStore organization methods ----------

test("TenantStore: organizations are CRUD'd and persisted alongside tenants", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctx-teamstore-"));
  const path = join(dir, "ctx.tenants.json");
  const store = new TenantStore([], path);

  store.upsertOrg({ id: "org-1", name: "acme", repos: "*", plan: "free" });
  store.upsert({ key: "sk-owner", name: "owner", repos: "*", orgId: "org-1", role: "owner" });
  store.upsert({ key: "sk-member", name: "member", repos: "*", orgId: "org-1", role: "member" });
  store.upsert({ key: "sk-solo", name: "solo", repos: "*" });

  assert.deepEqual(store.membersOf("org-1").map((t) => t.key).sort(), ["sk-member", "sk-owner"]);
  assert.equal(store.setOrgPlan("org-1", "team"), true);
  assert.equal(store.getOrg("org-1")?.plan, "team");
  assert.equal(store.setOrgPlan("org-nope", "team"), false);

  // Reload from disk — both tenants and organizations survive a restart.
  const reloaded = TenantStore.fromFile(path);
  assert.equal(reloaded.getOrg("org-1")?.plan, "team");
  assert.deepEqual(reloaded.membersOf("org-1").map((t) => t.key).sort(), ["sk-member", "sk-owner"]);
  assert.equal(reloaded.get("sk-solo")?.orgId, undefined);
});

test("UsageMeter: org members share one pooled counter, not one each", () => {
  const meter = new UsageMeter();
  const org: Organization = { id: "org-1", name: "acme", repos: "*", dailyLimit: 3 };
  const owner: Tenant = { key: "sk-owner", name: "owner", repos: "*", orgId: "org-1", role: "owner" };
  const member: Tenant = { key: "sk-member", name: "member", repos: "*", orgId: "org-1", role: "member" };

  assert.equal(meter.consume(owner, org), true);  // 1/3, pooled
  assert.equal(meter.consume(member, org), true); // 2/3, pooled — same counter as owner
  assert.equal(meter.report(owner, org).requests, 2, "owner's report reflects the whole org's usage");
  assert.equal(meter.report(member, org).requests, 2, "member's report reflects the whole org's usage too");
  assert.equal(meter.consume(member, org), true);  // 3/3
  assert.equal(meter.consume(owner, org), false, "org quota exhausted — blocks every seat, not just one");
});

// ---------- end-to-end over HTTP ----------

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

function startStripeMock(): Promise<{ baseURL: string; server: Server; sessions: Record<string, { client_reference_id: string }> }> {
  const sessions: Record<string, { client_reference_id: string }> = {};
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, obj: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const params = new URLSearchParams(body);
      const id = `cs_test_${Math.random().toString(36).slice(2, 10)}`;
      sessions[id] = { client_reference_id: params.get("client_reference_id") ?? "" };
      return send(200, { id, url: `https://checkout.stripe.com/test/${id}` });
    }
    send(404, { error: `mock: unhandled ${req.method} ${url.pathname}` });
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ baseURL: `http://127.0.0.1:${port}`, server, sessions });
    });
  });
}

test("team signup creates an org+owner, invite mints a shared-quota member, only the owner controls billing/roster", async () => {
  const stripe = await startStripeMock();
  const repo = makeRepo("team-e2e");
  const store = new TenantStore([]);
  const stripeSecret = "whsec_team";
  const server = createContextServer({ "team-e2e": repo }, {
    tenantStore: store,
    appBaseUrl: "http://ctx.local",
    stripeApiKey: "sk_test_x",
    stripeBaseURL: stripe.baseURL,
    stripeSecret,
    stripePriceMap: { price_team_test: "team" },
  });
  const base = await listen(server);

  try {
    // 1. Self-service signup for the Team plan mints an owner + a fresh org.
    const signup = await fetch(`${base}/v1/signup?plan=team`, { redirect: "manual" });
    assert.equal(signup.status, 302);
    const checkoutUrl = new URL(signup.headers.get("location")!);
    const sessionId = checkoutUrl.pathname.split("/").pop()!;
    const ownerKey = stripe.sessions[sessionId].client_reference_id;

    const ownerTenant = store.get(ownerKey);
    assert.ok(ownerTenant?.orgId, "signup created an org and put the tenant in it");
    assert.equal(ownerTenant?.role, "owner");
    const orgId = ownerTenant!.orgId!;
    assert.equal(store.getOrg(orgId)?.plan, "free", "unpaid until the webhook confirms the subscription");

    // 2. Stripe confirms the subscription → the ORG's plan flips, not a
    // standalone field on the tenant (billing is shared, not per-seat).
    const event = JSON.stringify({
      type: "customer.subscription.created",
      data: { object: { id: "sub_1", status: "active", metadata: { tenant_key: ownerKey }, items: { data: [{ price: { id: "price_team_test" } }] } } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", stripeSecret).update(`${ts}.${event}`).digest("hex");
    const webhook = await fetch(`${base}/v1/stripe/webhook`, {
      method: "POST", headers: { "stripe-signature": `t=${ts},v1=${sig}` }, body: event,
    });
    assert.equal(webhook.status, 200);
    assert.equal(store.getOrg(orgId)?.plan, "team");
    assert.equal(store.get(ownerKey)?.plan, undefined, "the tenant's own plan field is untouched — the org's governs");

    // 3. A plain solo tenant (no org) cannot invite — only owners can.
    store.upsert({ key: "sk-solo", name: "solo", repos: "*", plan: "free" });
    const soloInvite = await fetch(`${base}/v1/team/invite?name=bob`, { headers: { authorization: "Bearer sk-solo" } });
    assert.equal(soloInvite.status, 403);

    // 4. The owner invites a teammate.
    const invite = await fetch(`${base}/v1/team/invite?name=bob`, { headers: { authorization: `Bearer ${ownerKey}` } });
    assert.equal(invite.status, 200);
    const { key: memberKey } = await invite.json() as { key: string };
    assert.equal(store.get(memberKey)?.orgId, orgId);
    assert.equal(store.get(memberKey)?.role, "member");

    // 5. Usage is pooled: calls from either seat count against the same org
    // quota — including the owner's invite call just above (1), plus the two
    // /v1/usage calls below (2, 3): every authenticated request meters, not
    // just /v1/usage itself.
    await fetch(`${base}/v1/usage`, { headers: { authorization: `Bearer ${ownerKey}` } });
    const memberUsage = await (await fetch(`${base}/v1/usage`, { headers: { authorization: `Bearer ${memberKey}` } })).json() as { requests: number; dailyLimit: number };
    assert.equal(memberUsage.requests, 3, "owner's and member's calls all land in the same shared pool");
    assert.equal(memberUsage.dailyLimit, 50000, "team plan quota, inherited from the org");

    // 6. A member (not owner) cannot touch billing or the roster.
    const memberCheckout = await fetch(`${base}/v1/checkout?plan=team`, { headers: { authorization: `Bearer ${memberKey}` } });
    assert.equal(memberCheckout.status, 403);
    const memberInvite = await fetch(`${base}/v1/team/invite?name=carol`, { headers: { authorization: `Bearer ${memberKey}` } });
    assert.equal(memberInvite.status, 403);

    // 7. The owner's dashboard shows exactly the org's roster — not the
    // unrelated solo tenant from step 3.
    const dash = await (await fetch(`${base}/v1/dashboard/data`, { headers: { authorization: `Bearer ${ownerKey}` } })).json() as { tenants: { name: string }[] };
    assert.deepEqual(dash.tenants.map((t) => t.name).sort(), ["bob", `signup-${ownerKey.slice(-8)}`]);

    // 8. The owner cannot remove themselves…
    const selfRemove = await fetch(`${base}/v1/team/remove?key=${ownerKey}`, { headers: { authorization: `Bearer ${ownerKey}` } });
    assert.equal(selfRemove.status, 400);

    // …but can remove the teammate, who then loses access entirely.
    const remove = await fetch(`${base}/v1/team/remove?key=${memberKey}`, { headers: { authorization: `Bearer ${ownerKey}` } });
    assert.equal(remove.status, 200);
    assert.equal(store.get(memberKey), null);
    const revoked = await fetch(`${base}/v1/usage`, { headers: { authorization: `Bearer ${memberKey}` } });
    assert.equal(revoked.status, 401);
  } finally {
    server.close();
    stripe.server.close();
  }
});
