import test from "node:test";
import assert from "node:assert/strict";
import { renderBlogIndex, renderBlogPost } from "../blog.js";

test("renderBlogIndex lists posts with links to their slugs", () => {
  const html = renderBlogIndex();
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /Blog/);
  assert.match(html, /href="\/blog\/infrastructure-de-contexte-pour-agents-ia"/);
});

test("renderBlogPost renders a known post self-contained (no external script/asset)", () => {
  const html = renderBlogPost("infrastructure-de-contexte-pour-agents-ia");
  assert.ok(html);
  assert.match(html!, /mindset-ctx/);
  assert.match(html!, /<svg/, "cover art is inline SVG, not an external image");
  assert.ok(!html!.includes("platform.x.com"), "no third-party embed script");
  assert.ok(!html!.includes("<script"), "no scripts of any kind — static HTML");
});

test("renderBlogPost returns null for an unknown slug", () => {
  assert.equal(renderBlogPost("does-not-exist"), null);
});
