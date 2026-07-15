import { blogSlugs } from "./blog.js";

/** Public, crawlable pages — API routes (/v1/*) are deliberately excluded. */
const STATIC_PATHS = ["/", "/docs", "/pricing", "/blog"];

export function renderRobotsTxt(baseUrl?: string): string {
  const base = baseUrl?.replace(/\/+$/, "");
  return `User-agent: *
Allow: /
Disallow: /v1/
${base ? `\nSitemap: ${base}/sitemap.xml\n` : ""}`;
}

/** `baseUrl` is required here (unlike robots.txt) — sitemap <loc> entries must be absolute per spec. */
export function renderSitemapXml(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const paths = [...STATIC_PATHS, ...blogSlugs().map((slug) => `/blog/${slug}`)];
  const urls = paths.map((p) => `  <url><loc>${base}${p}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
