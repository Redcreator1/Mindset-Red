import test from "node:test";
import assert from "node:assert/strict";
import { renderPricing } from "../pricing.js";
import { renderHome } from "../home.js";

/**
 * Regression guard for the 18/07/2026 marketing-copy fix (see
 * docs/VISION.md): the hosted Worker (mindsetctx.com) is billing + dashboard
 * + quota only — it has no route to analyze a repo, search memory, or serve
 * MCP (Cloudflare Workers can't clone or read a git repo). That work always
 * runs in the self-hosted CLI. These claims must never reappear as things
 * the hosted plan itself delivers.
 */

const NEVER_ON_HOSTED_PLAN = [
  /recherche sémantique/i,
  /semantic search/i,
  /webhooks github/i,
  /mémoire d.équipe partagée/i,
];

test("pricing cards never claim hosted repo-analysis capability that the Worker doesn't have", () => {
  const html = renderPricing({ baseUrl: "https://example.com", availablePlans: new Set(["pro", "team", "enterprise"]) });
  for (const pattern of NEVER_ON_HOSTED_PLAN) {
    assert.doesNotMatch(html, pattern, `pricing page must not claim '${pattern}' — the hosted Worker has no such route`);
  }
  // SSO already shipped (WorkOS AuthKit, v0.16) — must not be marked "à venir".
  assert.doesNotMatch(html, /SSO.*à venir/i);
  assert.match(html, /SSO Entreprise/i);
});

test("the homepage's self-hosted/hosted split doesn't overclaim what the hosted Worker does", () => {
  const html = renderHome("https://example.com");
  for (const pattern of NEVER_ON_HOSTED_PLAN) {
    assert.doesNotMatch(html, pattern, `homepage must not claim '${pattern}' as a hosted-mode feature`);
  }
  assert.match(html, /self-hosted.*illimité/i, "self-hosted must still be described as free and unlimited");
});
