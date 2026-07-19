import test from "node:test";
import assert from "node:assert/strict";
import { renderTerms, renderPrivacy } from "../legal.js";

test("renderTerms is valid HTML stating the refund window, billing model, and support contact", () => {
  const html = renderTerms("https://example.com");
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /14 jours/, "refund window must be stated");
  assert.match(html, /self-hosted/i);
  assert.match(html, /mindset22633@gmail\.com/);
});

test("renderPrivacy states the code-never-collected principle and lists real subprocessors", () => {
  const html = renderPrivacy("https://example.com");
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /jamais.*(collect|transmis)/i);
  assert.match(html, /Stripe/);
  assert.match(html, /Cloudflare/);
  assert.match(html, /WorkOS/);
});

test("both legal pages flag missing legal-entity details rather than fabricating them", () => {
  for (const html of [renderTerms(), renderPrivacy()]) {
    assert.match(html, /RAISON SOCIALE À COMPLÉTER/);
    assert.match(html, /ADRESSE À COMPLÉTER/);
  }
});
