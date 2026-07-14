#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { analyzeRepo } from "./analyzer.js";
import { generateAll, mergePreservingManual } from "./generators.js";
import { indexCommits, writeMemory, mergeRecords, MEMORY_PATH } from "./memory.js";
import { fetchGitHubMemory, parseRepoFromRemote } from "./github.js";
import { fetchGitLabMemory, parseGitLabRepoFromRemote } from "./gitlab.js";
import { fetchBitbucketMemory, parseBitbucketRepoFromRemote } from "./bitbucket.js";
import { createContextServer } from "./server.js";
import { generateNarrative, hasApiKey } from "./ai.js";
import { runMcpServer } from "./mcp.js";
import { hasEmbeddingKey, indexEmbeddings, semanticSearch } from "./embeddings.js";
import { hybridSearch } from "./hybrid.js";
import { loadMemory, searchMemory } from "./memory.js";
import { TenantStore } from "./tenants.js";
import { loadPriceMap, type PlanId } from "./billing.js";
import { buildAppManifest, getInstallationToken, installUrlHint } from "./githubapp.js";
import { bootstrapStripePlans, createCheckoutSession, ensureStripeWebhook, newTenantKey, priceForPlan } from "./checkout.js";

const VERSION = "0.18.0";

const USAGE = `mindset-ctx — Context-as-a-Service for your repos

Usage:
  ctx generate [path] [--ai]   Analyze the repo and (re)generate context files:
                               CLAUDE.md, AGENTS.md, docs/ARCHITECTURE.md,
                               CONTRIBUTING.md, .context/prompts.md.
                               With --ai (requires ANTHROPIC_API_KEY), Claude
                               writes a narrative overview into CLAUDE.md and
                               the architecture doc
  ctx index [path] [--limit N] [--github|--gitlab|--bitbucket] [--repo owner/name] [--embed]
                               Index git history into the memory layer
                               (${MEMORY_PATH}). With --github, also ingest
                               PRs, issues and discussions via the GitHub API;
                               --gitlab does issues + merge requests via the
                               GitLab API; --bitbucket does pull requests +
                               issues via the Bitbucket Cloud API (owner/name
                               inferred from the origin remote unless --repo
                               is given; set GITHUB_TOKEN / GITLAB_TOKEN /
                               BITBUCKET_TOKEN for private repos or higher
                               rate limits). With --embed (requires
                               VOYAGE_API_KEY), also compute embeddings for
                               semantic search
  ctx search <query> [--repo-path path] [--semantic|--hybrid] [--limit N]
                               Search the memory layer from the terminal.
                               Default is BM25; --semantic uses embeddings;
                               --hybrid fuses both with Reciprocal Rank Fusion
  ctx serve [path ...] [--port N] [--api-key KEY] [--tenants FILE]
            [--webhook-secret S] [--stripe-secret S] [--base-url URL]
                               Serve one or more repos over HTTP for AI tools.
                               Multiple paths enable /v1/repos/:name/… routes;
                               --port (or CTX_PORT), --api-key (or
                               CTX_API_KEY) sets a single shared key;
                               --tenants (or CTX_TENANTS) points to a
                               ctx.tenants.json for per-tenant keys, repo
                               scopes and plan quotas (rewritten in place on
                               Stripe plan changes); see docs/DEPLOYMENT.md
                               for a Docker/VPC runbook;
                               --webhook-secret (or CTX_WEBHOOK_SECRET) enables
                               the GitHub webhook + App routes; --stripe-secret
                               (or CTX_STRIPE_SECRET, with STRIPE_PRICE_MAP)
                               enables POST /v1/stripe/webhook billing
  ctx app manifest [--base-url URL]
                               Print the GitHub App manifest (JSON) for
                               one-click App creation
  ctx app token <installation-id>
                               Mint a short-lived (1h) installation access
                               token for reading that installation's private
                               repos. Needs GITHUB_APP_ID +
                               GITHUB_APP_PRIVATE_KEY (the App's PEM key).
                               Installs auto-provision a tenant (see
                               /v1/app/webhook) whose key you'll find via
                               /v1/app/installed?installation_id=…
  ctx checkout --plan pro [--key KEY] [--success URL] [--cancel URL]
                               Mint a tenant key (unless --key is given) and
                               create a Stripe Checkout link to subscribe it.
                               Needs CTX_STRIPE_API_KEY + STRIPE_PRICE_MAP.
                               This is the "collect the first euro" front door
  ctx stripe bootstrap         Create the Pro/Team products+prices in Stripe
                               (idempotent) and print STRIPE_PRICE_MAP ready
                               to paste. Needs CTX_STRIPE_API_KEY.
  ctx stripe webhook <url>     Create (or reuse) a Stripe webhook endpoint
                               pointed at <url>/v1/stripe/webhook, idempotent
                               by URL, and print CTX_STRIPE_SECRET ready to
                               paste. Needs CTX_STRIPE_API_KEY. No Stripe
                               Dashboard access required — this is the
                               scriptable replacement for creating the
                               webhook by hand.
  ctx analyze [path]           Print the raw repo analysis as JSON
  ctx mcp [path]               Run an MCP (Model Context Protocol) server over
                               stdio exposing get_context, search_memory and
                               analyze_repo — for Claude Code, Cursor, etc.
                               e.g.: claude mcp add ctx -- node dist/cli.js mcp .
  ctx help                     Show this help

Hand-written content below the "ctx:manual" marker in generated files is
preserved across regenerations.`;

/** Flags that take no value; every other --flag consumes the next token. */
const BOOLEAN_FLAGS = new Set(["--github", "--gitlab", "--bitbucket", "--ai", "--embed", "--semantic", "--hybrid"]);

function arg(flag: string, argv: string[]): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

function positionals(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      if (!BOOLEAN_FLAGS.has(argv[i])) i++; // skip the flag's value
      continue;
    }
    out.push(argv[i]);
  }
  return out;
}

function targetDir(argv: string[]): string {
  return resolve(positionals(argv)[0] ?? ".");
}

async function cmdGenerate(root: string, argv: string[]): Promise<void> {
  const analysis = analyzeRepo(root);

  let narrative: string | undefined;
  if (argv.includes("--ai")) {
    if (!hasApiKey()) {
      console.error("--ai requires ANTHROPIC_API_KEY to be set.");
      process.exit(1);
    }
    console.log("Asking Claude for a narrative overview…");
    narrative = await generateNarrative(analysis);
  }

  const files = generateAll(analysis, narrative);
  for (const file of files) {
    const full = join(root, file.path);
    const existing = existsSync(full) ? readFileSync(full, "utf8") : null;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, mergePreservingManual(file.content, existing));
    console.log(`${existing ? "updated " : "created "} ${file.path}`);
  }
  console.log(`\nContext generated for ${analysis.name} (${analysis.fileCount} files scanned).`);
}

async function cmdIndex(root: string, argv: string[]): Promise<void> {
  const limit = Number(arg("--limit", argv) ?? 500) || 500;
  let records = indexCommits(root, limit);
  console.log(`Indexed ${records.length} commit(s) from git history`);

  if (argv.includes("--github")) {
    const repoFlag = arg("--repo", argv);
    const target = repoFlag
      ? { owner: repoFlag.split("/")[0], repo: repoFlag.split("/")[1] }
      : parseRepoFromRemote(analyzeRepo(root).remote);
    if (!target?.owner || !target?.repo) {
      console.error("Cannot determine GitHub repo: no origin remote found — pass --repo owner/name.");
      process.exit(1);
    }
    const gh = await fetchGitHubMemory(target.owner, target.repo, { limit });
    console.log(`Fetched ${gh.length} PR/issue/discussion record(s) from ${target.owner}/${target.repo}`);
    records = mergeRecords(records, gh);
  }

  if (argv.includes("--gitlab")) {
    const repoFlag = arg("--repo", argv);
    const target = repoFlag
      ? { owner: repoFlag.split("/")[0], repo: repoFlag.split("/")[1] }
      : parseGitLabRepoFromRemote(analyzeRepo(root).remote);
    if (!target?.owner || !target?.repo) {
      console.error("Cannot determine GitLab repo: no origin remote found — pass --repo owner/name.");
      process.exit(1);
    }
    const gl = await fetchGitLabMemory(target.owner, target.repo, { limit });
    console.log(`Fetched ${gl.length} issue/merge-request record(s) from ${target.owner}/${target.repo}`);
    records = mergeRecords(records, gl);
  }

  if (argv.includes("--bitbucket")) {
    const repoFlag = arg("--repo", argv);
    const target = repoFlag
      ? { owner: repoFlag.split("/")[0], repo: repoFlag.split("/")[1] }
      : parseBitbucketRepoFromRemote(analyzeRepo(root).remote);
    if (!target?.owner || !target?.repo) {
      console.error("Cannot determine Bitbucket repo: no origin remote found — pass --repo owner/name.");
      process.exit(1);
    }
    const bb = await fetchBitbucketMemory(target.owner, target.repo, { limit });
    console.log(`Fetched ${bb.length} PR/issue record(s) from ${target.owner}/${target.repo}`);
    records = mergeRecords(records, bb);
  }

  const path = writeMemory(root, records);
  console.log(`Wrote ${records.length} record(s) to ${path}`);

  if (argv.includes("--embed")) {
    if (!hasEmbeddingKey()) {
      console.error("--embed requires VOYAGE_API_KEY to be set.");
      process.exit(1);
    }
    const embedded = await indexEmbeddings(root, records);
    console.log(`Embedded ${embedded} new record(s) for semantic search`);
  }
}

async function cmdSearch(argv: string[]): Promise<void> {
  const query = positionals(argv)[0];
  if (!query) {
    console.error("Usage: ctx search <query> [--repo-path path] [--semantic] [--limit N]");
    process.exit(1);
  }
  const root = resolve(arg("--repo-path", argv) ?? ".");
  const limit = Number(arg("--limit", argv) ?? 10) || 10;
  const records = loadMemory(root);
  if (argv.includes("--hybrid")) {
    const hits = await hybridSearch(root, records, query, limit);
    if (hits.length === 0) return void console.log("No matching records.");
    for (const h of hits) {
      const ranks = `L${h.lexicalRank ?? "–"}/S${h.semanticRank ?? "–"}`;
      console.log(`[${h.record.type}] ${h.record.title}  (${ranks}, ${h.record.date.slice(0, 10)})`);
    }
    return;
  }
  const hits = argv.includes("--semantic")
    ? await semanticSearch(root, records, query, limit)
    : searchMemory(records, query, limit);
  if (hits.length === 0) {
    console.log("No matching records.");
    return;
  }
  for (const hit of hits) {
    console.log(`[${hit.type}] ${hit.title}  (${hit.author}, ${hit.date.slice(0, 10)})`);
  }
}

function cmdServe(argv: string[]): void {
  const port = Number(arg("--port", argv) ?? process.env.CTX_PORT ?? 4870) || 4870;
  const apiKey = arg("--api-key", argv) ?? process.env.CTX_API_KEY;
  const webhookSecret = arg("--webhook-secret", argv) ?? process.env.CTX_WEBHOOK_SECRET;
  const stripeSecret = arg("--stripe-secret", argv) ?? process.env.CTX_STRIPE_SECRET;
  const stripeApiKey = arg("--stripe-api-key", argv) ?? process.env.CTX_STRIPE_API_KEY;
  const stripePriceMap = loadPriceMap(process.env.STRIPE_PRICE_MAP);
  const appBaseUrl = arg("--base-url", argv) ?? process.env.CTX_BASE_URL;
  const tenantsFile = arg("--tenants", argv) ?? process.env.CTX_TENANTS;
  const tenantStore = tenantsFile ? TenantStore.fromFile(resolve(tenantsFile)) : undefined;
  const paths = positionals(argv).map((p) => resolve(p));
  if (paths.length === 0) paths.push(resolve("."));
  const repos = Object.fromEntries(paths.map((p) => [basename(p) || "repo", p]));

  createContextServer(repos, { apiKey, tenantStore, webhookSecret, stripeSecret, stripeApiKey, stripePriceMap, appBaseUrl }).listen(port, () => {
    const names = Object.keys(repos);
    const authLabel = tenantStore ? ` [${tenantStore.all().length} tenant(s)]` : apiKey ? " [api-key required]" : "";
    const flags = [webhookSecret && "webhooks", stripeSecret && "stripe"].filter(Boolean).join("+");
    console.log(`mindset-ctx serving ${names.length} repo(s): ${names.join(", ")}${authLabel}${flags ? ` [${flags}]` : ""}`);
    console.log(`  http://localhost:${port}/v1/health`);
    console.log(`  http://localhost:${port}/v1/dashboard`);
    console.log(`  http://localhost:${port}/v1/repos`);
    console.log(`  http://localhost:${port}/v1/app/manifest`);
    if (stripeSecret) console.log(`  http://localhost:${port}/v1/stripe/webhook  (POST)`);
    if (names.length === 1) {
      console.log(`  http://localhost:${port}/v1/context/claude   (agents|architecture|contributing|prompts)`);
      console.log(`  http://localhost:${port}/v1/memory/search?q=fix`);
    } else {
      console.log(`  http://localhost:${port}/v1/repos/${names[0]}/context/claude`);
      console.log(`  http://localhost:${port}/v1/repos/${names[0]}/memory/search?q=fix`);
    }
  });
}

async function cmdCheckout(argv: string[]): Promise<void> {
  const secretKey = process.env.CTX_STRIPE_API_KEY;
  if (!secretKey) {
    console.error("ctx checkout needs CTX_STRIPE_API_KEY (your Stripe secret key sk_...).");
    process.exit(1);
  }
  const priceMap = loadPriceMap(process.env.STRIPE_PRICE_MAP);
  const plan = (arg("--plan", argv) ?? "pro") as PlanId;
  const priceId = priceForPlan(plan, priceMap);
  if (!priceId) {
    console.error(`No Stripe price mapped for plan '${plan}'. Set STRIPE_PRICE_MAP, e.g. '{"price_123":"pro"}'.`);
    process.exit(1);
  }
  const tenantKey = arg("--key", argv) ?? newTenantKey();
  const base = process.env.CTX_BASE_URL ?? "https://example.com";
  const session = await createCheckoutSession({
    secretKey,
    priceId,
    tenantKey,
    successUrl: arg("--success", argv) ?? `${base}/v1/dashboard`,
    cancelUrl: arg("--cancel", argv) ?? `${base}/v1/dashboard`,
  });
  console.log(`Tenant key : ${tenantKey}`);
  console.log(`Plan       : ${plan}`);
  console.log(`Pay here   : ${session.url}`);
  console.error(`\nAdd this tenant to ctx.tenants.json (plan flips to '${plan}' automatically once paid):`);
  console.error(JSON.stringify({ key: tenantKey, name: "new-customer", repos: "*", plan: "free" }, null, 2));
}

async function cmdStripe(argv: string[]): Promise<void> {
  const sub = positionals(argv)[0];
  const secretKey = process.env.CTX_STRIPE_API_KEY;
  if (!secretKey) {
    console.error(`ctx stripe ${sub ?? ""} needs CTX_STRIPE_API_KEY (your Stripe secret key sk_...).`);
    process.exit(1);
  }

  if (sub === "bootstrap") {
    const map = await bootstrapStripePlans(secretKey);
    console.error("Created/reused Stripe products + prices. Paste this into your env:");
    console.log(`STRIPE_PRICE_MAP='${JSON.stringify(map)}'`);
    return;
  }

  if (sub === "webhook") {
    const url = positionals(argv)[1];
    if (!url) {
      console.error("Usage: ctx stripe webhook <https://your-host/v1/stripe/webhook>");
      process.exit(1);
    }
    const result = await ensureStripeWebhook(secretKey, url);
    if (result.created) {
      console.error(`Created webhook endpoint ${result.id} for ${result.url}. Save this as CTX_STRIPE_SECRET:`);
      console.log(`CTX_STRIPE_SECRET='${result.secret}'`);
    } else {
      console.error(
        `Endpoint ${result.id} already targets ${result.url} — Stripe never re-exposes its signing ` +
          `secret, so no new CTX_STRIPE_SECRET was printed. If you've lost it, delete the endpoint in the ` +
          `Stripe Dashboard and re-run this command to mint a fresh one.`,
      );
    }
    return;
  }

  console.error("Usage: ctx stripe bootstrap | ctx stripe webhook <url>");
  process.exit(1);
}

async function cmdApp(argv: string[]): Promise<void> {
  const sub = positionals(argv)[0];
  const baseUrl = arg("--base-url", argv) ?? process.env.CTX_BASE_URL ?? "https://your-host.example.com";
  if (sub === "manifest" || sub === undefined) {
    console.log(JSON.stringify(buildAppManifest(baseUrl), null, 2));
    console.error(`\n${installUrlHint(baseUrl)}`);
    return;
  }
  if (sub === "token") {
    const installationId = Number(positionals(argv)[1]);
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!installationId) {
      console.error("Usage: ctx app token <installation-id>");
      process.exit(1);
    }
    if (!appId || !privateKey) {
      console.error("ctx app token needs GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (the App's PEM private key) set.");
      process.exit(1);
    }
    const result = await getInstallationToken(appId, privateKey, installationId);
    console.error(`Installation token for installation ${installationId} (expires ${result.expiresAt}):`);
    console.log(result.token);
    console.error(`\nUse it to clone a private repo it covers:`);
    console.error(`  git clone https://x-access-token:${result.token}@github.com/OWNER/REPO.git`);
    return;
  }
  console.error(`Unknown app subcommand '${sub}'. Try: ctx app manifest | ctx app token <installation-id>`);
  process.exit(1);
}

const [, , command, ...rest] = process.argv;
const root = targetDir(rest);

switch (command) {
  case "generate":
    await cmdGenerate(root, rest);
    break;
  case "index":
    await cmdIndex(root, rest);
    break;
  case "search":
    await cmdSearch(rest);
    break;
  case "serve":
    cmdServe(rest);
    break;
  case "app":
    await cmdApp(rest);
    break;
  case "checkout":
    await cmdCheckout(rest);
    break;
  case "stripe":
    await cmdStripe(rest);
    break;
  case "analyze":
    console.log(JSON.stringify(analyzeRepo(root), null, 2));
    break;
  case "mcp":
    runMcpServer(root, VERSION);
    break;
  case "help":
  case undefined:
    console.log(USAGE);
    break;
  default:
    console.error(`Unknown command '${command}'.\n`);
    console.log(USAGE);
    process.exit(1);
}
