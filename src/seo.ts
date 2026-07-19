import { blogSlugs, blogPostsMeta } from "./blog.js";
import { REPO_URL } from "./home.js";

/** Public, crawlable pages — API routes (/v1/*) are deliberately excluded. */
const STATIC_PATHS = ["/", "/docs", "/pricing", "/blog", "/terms", "/privacy", "/support"];

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

/**
 * llms.txt (llmstxt.org convention) — a plain-Markdown map of the site for
 * LLMs/agents that fetch it before crawling HTML. `baseUrl` required, same
 * reasoning as the sitemap: links here are read out of context by another
 * system, so they must be absolute.
 */
export function renderLlmsTxt(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const posts = blogPostsMeta()
    .map((p) => `- [${p.title}](${base}/blog/${p.slug}): ${p.excerpt}`)
    .join("\n");

  return `# mindset-ctx

> Context-as-a-Service : génère et maintient le contexte dont les agents IA ont besoin (CLAUDE.md, AGENTS.md, docs/ARCHITECTURE.md, CONTRIBUTING.md, templates de prompts) pour n'importe quel repo GitHub/GitLab, avec une mémoire indexée de son historique (commits, PRs, issues) interrogeable en BM25/sémantique/hybride. Expose aussi un serveur MCP (stdio) avec trois outils : get_context, search_memory, analyze_repo.

## Démarrer

- [Dépôt GitHub (code source, MIT)](${REPO_URL}): installation, CLI, doc complète du serveur MCP (Claude Code, Cursor) et de l'API HTTP
- [Documentation](${base}/docs): point d'entrée vers le README et les docs du repo
- [Tarifs](${base}/pricing): plans du mode hébergé (self-hosted toujours gratuit et illimité)

## Legal

- [Conditions d'utilisation](${base}/terms)
- [Politique de confidentialité](${base}/privacy)
- [Support](${base}/support)

## Blog
${posts}
`;
}
