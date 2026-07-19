import test from "node:test";
import assert from "node:assert/strict";
import { renderRobotsTxt, renderSitemapXml } from "../seo.js";
import { render404 } from "../home.js";
import { FAVICON_SVG } from "../favicon.js";

test("renderRobotsTxt disallows /v1/, allows everything else, and points at the sitemap only when baseUrl is set", () => {
  const withBase = renderRobotsTxt("https://ctx.example.com");
  assert.match(withBase, /Disallow: \/v1\//);
  assert.match(withBase, /Allow: \//);
  assert.match(withBase, /Sitemap: https:\/\/ctx\.example\.com\/sitemap\.xml/);

  const withoutBase = renderRobotsTxt();
  assert.ok(!withoutBase.includes("Sitemap:"), "no broken relative sitemap URL without a baseUrl");
});

test("renderSitemapXml lists every static page and every blog post with absolute URLs", () => {
  const xml = renderSitemapXml("https://ctx.example.com");
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  for (const path of ["/", "/docs", "/pricing", "/blog", "/terms", "/privacy"]) {
    assert.match(xml, new RegExp(`<loc>https://ctx\\.example\\.com${path.replace("/", "\\/")}</loc>`));
  }
  assert.match(xml, /<loc>https:\/\/ctx\.example\.com\/blog\/infrastructure-de-contexte-pour-agents-ia<\/loc>/);
});

test("render404 is a real styled page, not a bare error string", () => {
  const html = render404("https://ctx.example.com");
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /404/);
  assert.match(html, /href="\/"/, "links back to the homepage");
});

test("FAVICON_SVG is a well-formed inline SVG icon", () => {
  assert.match(FAVICON_SVG, /^<svg /);
  assert.match(FAVICON_SVG, /viewBox="0 0 64 64"/);
});
