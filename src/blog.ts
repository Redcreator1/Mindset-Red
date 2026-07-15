import { esc, REPO_URL, shell } from "./home.js";

/**
 * Native blog — announcements written and rendered on our own domain instead
 * of embedding third-party widgets (e.g. an X/Twitter embed script), which
 * would pull in an external script, external tracking, and a card that
 * doesn't match the site's own design. Cover art is inline SVG for the same
 * reason: no separate image asset to host, no extra request, crisp at any
 * size, and it's just markup — trivial to keep in the same palette as the
 * rest of the site.
 *
 * Post bodies are hand-authored HTML (bodyHtml), not user input — never run
 * through esc(). Only render posts that come from this file.
 */

export interface BlogPost {
  slug: string;
  title: string;
  date: string; // YYYY-MM-DD
  excerpt: string;
  bodyHtml: string;
}

function coverSvg(): string {
  return `
<svg viewBox="0 0 1600 640" role="img" aria-label="mindset-ctx — l'infrastructure de contexte pour agents IA" style="width:100%;height:auto;border-radius:14px;border:1px solid #1e293b">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111a2e"/><stop offset="100%" stop-color="#0b1220"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#60a5fa"/><stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#2563eb" stop-opacity="0.25"/><stop offset="100%" stop-color="#2563eb" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="640" fill="url(#bg)"/>
  <circle cx="1250" cy="150" r="420" fill="url(#glow)"/>
  <circle cx="150" cy="550" r="320" fill="url(#glow)"/>
  <g transform="translate(120,220)">
    <rect x="-40" y="-40" width="280" height="280" rx="52" fill="#0f1830" stroke="#1e293b" stroke-width="2"/>
    <path d="M60 20 L28 20 Q16 20 16 32 L16 168 Q16 180 28 180 L60 180" fill="none" stroke="url(#accent)" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M140 20 L172 20 Q184 20 184 32 L184 168 Q184 180 172 180 L140 180" fill="none" stroke="url(#accent)" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="100" cy="100" r="28" fill="url(#accent)"/>
  </g>
  <text x="470" y="270" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="88" font-weight="700" fill="#f1f5f9">mindset-ctx</text>
  <text x="470" y="330" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="34" font-weight="500" fill="#93c5fd">L'infrastructure de contexte pour agents IA</text>
  <text x="470" y="390" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="24" fill="#94a3b8">CLAUDE.md · AGENTS.md · mémoire projet · MCP — toujours à jour</text>
  <g font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="22" font-weight="600">
    <rect x="470" y="440" width="150" height="52" rx="26" fill="#0f2e1c" stroke="#14532d"/>
    <text x="545" y="474" fill="#86efac" text-anchor="middle">Open source</text>
    <rect x="640" y="440" width="140" height="52" rx="26" fill="#111a2e" stroke="#1e3a8a"/>
    <text x="710" y="474" fill="#93c5fd" text-anchor="middle">npm</text>
    <rect x="800" y="440" width="200" height="52" rx="26" fill="#111a2e" stroke="#1e3a8a"/>
    <text x="900" y="474" fill="#93c5fd" text-anchor="middle">VS Code</text>
    <rect x="1020" y="440" width="220" height="52" rx="26" fill="#111a2e" stroke="#1e3a8a"/>
    <text x="1130" y="474" fill="#93c5fd" text-anchor="middle">SSO Entreprise</text>
  </g>
</svg>`;
}

function featuresSvg(): string {
  const rows: [string, string][] = [
    ["Core", "Génère et maintient CLAUDE.md, AGENTS.md, architecture, prompts"],
    ["Memory", "Historique du repo indexé — BM25, sémantique, fusion RRF"],
    ["Gateway", "Serveur MCP natif — Claude Code, Cursor, et la suite"],
    ["Ops", "Dashboard, quotas, facturation Stripe — self-hosted ou hébergé"],
    ["Teams", "Organisations multi-sièges, quota partagé, rôles owner/member"],
    ["SSO Entreprise", "Connexion WorkOS AuthKit — provisioning automatique par entreprise"],
  ];
  const rowsSvg = rows
    .map(([title, desc], i) => {
      const y = 200 + i * 90;
      return `
    <circle cx="90" cy="${y}" r="26" fill="#0f2e1c" stroke="#14532d" stroke-width="2"/>
    <path d="M${78} ${y} l9 9 l17 -19" fill="none" stroke="#86efac" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="140" y="${y - 8}" font-size="30" font-weight="700" fill="#f1f5f9">${esc(title)}</text>
    <text x="140" y="${y + 22}" font-size="22" fill="#94a3b8">${esc(desc)}</text>`;
    })
    .join("");
  return `
<svg viewBox="0 0 1200 850" role="img" aria-label="Ce qui tourne déjà en production" style="width:100%;height:auto;border-radius:14px;border:1px solid #1e293b">
  <defs>
    <linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#111a2e"/><stop offset="100%" stop-color="#0b1220"/></linearGradient>
    <linearGradient id="accent2" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#60a5fa"/><stop offset="100%" stop-color="#2563eb"/></linearGradient>
  </defs>
  <rect width="1200" height="850" fill="url(#bg2)"/>
  <text x="60" y="90" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="42" font-weight="700" fill="#f1f5f9">Ce qui tourne déjà en production</text>
  <rect x="60" y="112" width="120" height="6" rx="3" fill="url(#accent2)"/>
  <g font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">${rowsSvg}</g>
  <text x="60" y="800" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="22" fill="#64748b">npm install -g mindset-ctx · gratuit pour démarrer</text>
</svg>`;
}

const POSTS: BlogPost[] = [
  {
    slug: "infrastructure-de-contexte-pour-agents-ia",
    title: "mindset-ctx — l'infrastructure de contexte pour agents IA",
    date: "2026-07-15",
    excerpt:
      "Un agent IA est aussi bon que le contexte qu'on lui donne. Voici comment mindset-ctx génère, maintient et sert ce contexte automatiquement.",
    bodyHtml: `
${coverSvg()}
<p>Un agent IA est aussi bon que le contexte qu'on lui donne. Sans ça, il redécouvre
à chaque session ce que votre équipe a déjà décidé — vos conventions, votre
architecture, pourquoi telle décision a été prise en mars.</p>

<p><strong>mindset-ctx</strong> résout ça : il génère et maintient automatiquement les
fichiers de contexte (<code>CLAUDE.md</code>, <code>AGENTS.md</code>, documentation
d'architecture) à partir de votre repo, indexe son historique dans une mémoire
interrogeable, et expose tout ça nativement en MCP — pour Claude Code, Cursor, et tout
agent qui parle ce protocole.</p>

<p>Pas un générateur figé. Un service qui tourne, qui se met à jour à chaque push,
indépendant du modèle branché dessus.</p>

${featuresSvg()}

<p>Ce qui rend ça crédible : c'est déployé, pas juste codé. Dashboard, facturation
Stripe, GitHub App auto-provisionnée, SSO Entreprise via WorkOS, organisations
multi-sièges — tout tourne en parité complète sur un serveur self-hosted et sur
Cloudflare Workers, avec une suite de tests qui grandit à chaque brique.</p>

<h2>Installation</h2>
<pre>npm install -g mindset-ctx
ctx generate .</pre>

<p>Ou directement dans VS Code : recherchez "mindset-ctx" dans les extensions.</p>

<p>Open source, sur GitHub : <a href="${REPO_URL}">${REPO_URL.replace("https://", "")}</a></p>
`,
  },
];

/** List of posts, newest first. */
export function renderBlogIndex(baseUrl?: string): string {
  const items = [...POSTS]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(
      (p) => `
    <a class="post-card" href="/blog/${esc(p.slug)}">
      <time>${esc(p.date)}</time>
      <h2>${esc(p.title)}</h2>
      <p>${esc(p.excerpt)}</p>
    </a>`,
    )
    .join("");

  const body = `
<style>
  main.blog { max-width: 760px; margin: 0 auto; padding: 32px 32px 64px; }
  main.blog h1 { font-size: 28px; margin: 8px 0 28px; }
  .post-card { display: block; background: #111a2e; border: 1px solid #1e293b; border-radius: 12px;
    padding: 22px 24px; margin-bottom: 16px; text-decoration: none; color: inherit; }
  .post-card:hover { border-color: #2563eb; }
  .post-card time { font-size: 13px; color: #64748b; font-family: ui-monospace, monospace; }
  .post-card h2 { margin: 6px 0 8px; font-size: 19px; color: #e2e8f0; }
  .post-card p { margin: 0; color: #94a3b8; font-size: 14px; }
</style>
<main class="blog">
  <h1>Blog</h1>
  ${items || "<p>Rien à afficher pour l'instant.</p>"}
</main>`;
  return shell({
    title: "Blog — mindset-ctx",
    description: "Annonces et notes de mindset-ctx — l'infrastructure de contexte pour agents IA.",
    body,
    baseUrl,
    path: "/blog",
  });
}

/** A single post's page, or null if the slug doesn't match any post (caller renders 404). */
export function renderBlogPost(slug: string, baseUrl?: string): string | null {
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) return null;

  const body = `
<style>
  main.post { max-width: 760px; margin: 0 auto; padding: 32px 32px 64px; }
  main.post .back { display: inline-block; margin-bottom: 20px; font-size: 14px; }
  main.post h1 { font-size: 30px; line-height: 1.25; margin: 0 0 8px; }
  main.post time { display: block; font-size: 13px; color: #64748b; font-family: ui-monospace, monospace; margin-bottom: 28px; }
  main.post p { color: #cbd5e1; font-size: 16px; line-height: 1.7; margin: 0 0 20px; }
  main.post h2 { font-size: 20px; margin: 36px 0 12px; color: #e2e8f0; }
  main.post code { background: #111a2e; border-radius: 4px; padding: 2px 6px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 14px; }
  main.post pre { background: #111a2e; border: 1px solid #1e293b; border-radius: 10px; padding: 18px 20px;
    overflow-x: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 14px; color: #cbd5e1; margin: 0 0 20px; }
  main.post svg { display: block; margin: 28px 0; }
</style>
<main class="post">
  <a class="back" href="/blog">&larr; Blog</a>
  <h1>${esc(post.title)}</h1>
  <time>${esc(post.date)}</time>
  ${post.bodyHtml}
</main>`;
  return shell({
    title: `${post.title} — mindset-ctx`,
    description: post.excerpt,
    body,
    baseUrl,
    path: `/blog/${slug}`,
  });
}
