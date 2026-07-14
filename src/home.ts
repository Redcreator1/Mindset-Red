/**
 * The public vitrine — root domain landing page and docs index. Separate
 * from pricing.ts on purpose: pricing.ts is the payment funnel (plans,
 * checkout, success), this is the front door that explains what mindset-ctx
 * *is* before anyone gets near a "buy" button. Written so that the moment a
 * real domain (mindset-ctx.dev) is pointed at this Worker, there is nothing
 * left to build — only DNS.
 */

const REPO_URL = "https://github.com/Redcreator1/Mindset-Red";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const BASE_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #0b1220; color: #e2e8f0; }
  a { color: #60a5fa; }
  header.top { display: flex; align-items: center; justify-content: space-between;
    padding: 20px 32px; max-width: 1100px; margin: 0 auto; }
  .brand { font-weight: 700; font-size: 16px; color: #e2e8f0; text-decoration: none; }
  .brand .dot { color: #d4a24c; }
  nav.top a { margin-left: 24px; font-size: 14px; color: #94a3b8; text-decoration: none; }
  nav.top a:hover { color: #e2e8f0; }
  footer { padding: 40px 32px; text-align: center; color: #475569; font-size: 13px; }
  footer a { color: #64748b; }
`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${BASE_STYLE}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="/">mindset<span class="dot">·</span>ctx</a>
  <nav class="top">
    <a href="/docs">Documentation</a>
    <a href="/pricing">Tarifs</a>
    <a href="${REPO_URL}">GitHub</a>
  </nav>
</header>
${body}
<footer>
  Repos privés → <strong>self-hosted, votre code ne quitte jamais votre machine.</strong><br>
  <a href="${REPO_URL}">GitHub</a> · <a href="/docs">Documentation</a> · <a href="/pricing">Tarifs</a> · <a href="/v1/dashboard">Dashboard</a>
</footer>
</body></html>`;
}

/** The root domain landing page — the thesis, not the price list. */
export function renderHome(): string {
  const body = `
<style>
  main.hero { max-width: 780px; margin: 0 auto; padding: 48px 32px 32px; text-align: center; }
  h1 { font-size: clamp(28px, 4.4vw, 42px); line-height: 1.2; margin: 0 0 20px; text-wrap: balance; }
  h1 .accent { color: #60a5fa; }
  .sub { font-size: 18px; color: #94a3b8; max-width: 56ch; margin: 0 auto 32px; }
  .cta-row { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; margin-bottom: 8px; }
  .cta { display: inline-block; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px; }
  .cta.primary { background: #2563eb; color: #fff; }
  .cta.secondary { background: #1e293b; color: #e2e8f0; }
  .cta:hover { filter: brightness(1.12); }

  section.strip { max-width: 1000px; margin: 56px auto; padding: 0 32px; }
  .grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; }
  .card { background: #111a2e; border: 1px solid #1e293b; border-radius: 14px; padding: 24px; }
  .card .tag { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #60a5fa; }
  .card h3 { margin: 8px 0 8px; font-size: 17px; }
  .card p { margin: 0; color: #94a3b8; font-size: 14px; }

  section.trust { max-width: 700px; margin: 56px auto; padding: 0 32px; text-align: center; }
  section.trust p { color: #94a3b8; font-size: 15px; }
  section.trust strong { color: #e2e8f0; }

  section.quick { max-width: 700px; margin: 0 auto 64px; padding: 0 32px; }
  section.quick h2 { font-size: 14px; letter-spacing: .06em; text-transform: uppercase; color: #94a3b8; text-align: center; margin-bottom: 16px; }
  pre { background: #0b1220; border: 1px solid #1e293b; border-radius: 10px; padding: 18px 20px;
    overflow-x: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13.5px; color: #cbd5e1; }
</style>

<main class="hero">
  <h1>Votre agent IA ne connaît que ce que vous <span class="accent">lui donnez</span>.</h1>
  <p class="sub">
    mindset-ctx génère et maintient à jour le contexte dont Claude Code, Cursor et
    tout agent MCP ont besoin pour vraiment comprendre votre code — pas juste le lire.
  </p>
  <div class="cta-row">
    <a class="cta primary" href="/pricing">Voir les tarifs</a>
    <a class="cta secondary" href="/docs">Documentation</a>
  </div>
</main>

<section class="strip">
  <div class="grid3">
    <div class="card">
      <span class="tag">Core</span>
      <h3>Contexte généré</h3>
      <p>CLAUDE.md, AGENTS.md, architecture, prompts — depuis l'analyse réelle de votre repo, pas un template générique.</p>
    </div>
    <div class="card">
      <span class="tag">Memory</span>
      <h3>Mémoire du projet</h3>
      <p>Historique git, PRs, issues indexés et interrogeables — BM25, sémantique, ou les deux fusionnés (RRF).</p>
    </div>
    <div class="card">
      <span class="tag">Gateway</span>
      <h3>Natif MCP</h3>
      <p>Claude Code et Cursor consomment le contexte comme des outils natifs. GitHub, GitLab et Bitbucket supportés.</p>
    </div>
  </div>
</section>

<section class="trust">
  <p>
    <strong>Le mode self-hosted est gratuit et illimité.</strong> Il lit le clone
    local de votre repo — votre code privé ne quitte jamais votre machine. Le mode
    hébergé (dashboard, quotas, recherche sémantique) est ce qui est payant.
  </p>
</section>

<section class="quick">
  <h2>Démarrer en 30 secondes</h2>
  <pre>npx mindset-ctx generate    # génère CLAUDE.md, AGENTS.md, l'architecture…
npx mindset-ctx index       # indexe git, PRs et issues dans la mémoire
npx mindset-ctx mcp .       # expose tout ça à Claude Code / Cursor via MCP</pre>
</section>
`;
  return shell("mindset-ctx — l'infrastructure de contexte pour vos agents IA", body);
}

interface DocSection {
  title: string;
  items: { label: string; href: string; note?: string }[];
}

const DOC_SECTIONS: DocSection[] = [
  {
    title: "Démarrer",
    items: [
      { label: "Installation & premiers pas", href: `${REPO_URL}#installation` },
      { label: "Générer le contexte (ctx generate)", href: `${REPO_URL}#g%C3%A9n%C3%A9rer-le-contexte` },
      { label: "Indexer la mémoire (ctx index)", href: `${REPO_URL}#m%C3%A9moire-du-projet` },
    ],
  },
  {
    title: "Intégrations agents",
    items: [
      { label: "Claude Code (MCP)", href: `${REPO_URL}#mcp-model-context-protocol` },
      { label: "Cursor (MCP natif, .cursor/mcp.json)", href: `${REPO_URL}#mcp-model-context-protocol` },
    ],
  },
  {
    title: "Sources de code supportées",
    items: [
      { label: "GitHub — PRs, issues, discussions, App", href: `${REPO_URL}#repos-priv%C3%A9s--comment-les-devs-lutilisent` },
      { label: "GitLab — issues + merge requests", href: `${REPO_URL}#repos-priv%C3%A9s--comment-les-devs-lutilisent` },
      { label: "Bitbucket — pull requests + issues", href: `${REPO_URL}#repos-priv%C3%A9s--comment-les-devs-lutilisent` },
    ],
  },
  {
    title: "Hébergement",
    items: [
      { label: "Self-hosted (gratuit, votre code reste chez vous)", href: `${REPO_URL}#repos-priv%C3%A9s--comment-les-devs-lutilisent` },
      { label: "Hébergé (dashboard, quotas, Stripe)", href: `${REPO_URL}#d%C3%A9ploiement-en-production-0--premier-euro` },
      { label: "Enterprise dédié / VPC (Docker)", href: `${REPO_URL}/blob/main/docs/DEPLOYMENT.md` },
    ],
  },
  {
    title: "Référence API",
    items: [
      { label: "Toutes les routes HTTP", href: `${REPO_URL}#api-hors-cli` },
      { label: "Dashboard (/v1/dashboard)", href: "/v1/dashboard" },
      { label: "Health check (/v1/health)", href: "/v1/health" },
    ],
  },
];

/** Documentation index — links out to the (public) repo's README/docs rather than duplicating content. */
export function renderDocs(): string {
  const sections = DOC_SECTIONS.map(
    (s) => `
    <div class="doc-card">
      <h2>${esc(s.title)}</h2>
      <ul>
        ${s.items.map((it) => `<li><a href="${esc(it.href)}">${esc(it.label)}</a></li>`).join("")}
      </ul>
    </div>`,
  ).join("");

  const body = `
<style>
  main.docs { max-width: 860px; margin: 0 auto; padding: 32px 32px 64px; }
  main.docs h1 { font-size: 28px; margin: 8px 0 8px; }
  main.docs > p { color: #94a3b8; margin: 0 0 36px; max-width: 60ch; }
  .doc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
  .doc-card { background: #111a2e; border: 1px solid #1e293b; border-radius: 12px; padding: 22px 24px; }
  .doc-card h2 { margin: 0 0 12px; font-size: 15px; color: #60a5fa; }
  .doc-card ul { list-style: none; margin: 0; padding: 0; }
  .doc-card li { padding: 7px 0; border-bottom: 1px solid #1e293b; font-size: 14px; }
  .doc-card li:last-child { border-bottom: none; }
</style>
<main class="docs">
  <h1>Documentation</h1>
  <p>La doc complète vit dans le README du repo (public) — organisée ici par tâche
  plutôt que dupliquée. Le code source de chaque intégration est à côté, si vous
  voulez vérifier exactement ce qui se passe.</p>
  <div class="doc-grid">${sections}</div>
</main>`;
  return shell("Documentation — mindset-ctx", body);
}
