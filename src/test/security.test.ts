import test from "node:test";
import assert from "node:assert/strict";
import { renderSecurity } from "../security.js";

test("renderSecurity is valid HTML surfacing the verifiable posture (open source, tests, 0 vulns)", () => {
  const html = renderSecurity("https://example.com");
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /open source/i);
  assert.match(html, /npm.?audit/i);
  assert.match(html, /self-hosted/i, "the code-never-leaves-your-machine principle must be stated");
});

test("renderSecurity keeps the anti-overselling discipline: it states what is NOT claimed (no SOC 2 / pentest / bounty)", () => {
  // This is the load-bearing test: the page's credibility comes from being
  // honest about its limits, so a future edit must not silently drop the
  // "what we don't claim" section and imply certifications we don't have.
  const html = renderSecurity();
  assert.match(html, /SOC(&nbsp;|\s)*2/i);
  assert.match(html, /p[ée]n[ée]tration|pentest/i);
  assert.match(html, /bug bounty/i);
});
