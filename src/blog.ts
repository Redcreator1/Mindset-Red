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
    slug: "comment-on-audite-mindset-ctx",
    title: "Comment on audite mindset-ctx : la méthode, pas juste le résultat",
    date: "2026-07-19",
    excerpt:
      "\"On prend la sécurité au sérieux\" ne veut rien dire tant que ça n'est pas vérifiable. Voici exactement comment on a audité mindset-ctx cette semaine, ce qu'on a trouvé, et pourquoi la plupart des pistes soulevées n'ont pas survécu au second regard.",
    bodyHtml: `
<p>"On prend la sécurité au sérieux" est probablement la phrase la plus répétée et la
moins vérifiable du logiciel. N'importe qui peut l'écrire. Ce qui distingue une vraie
revue d'un slogan, c'est la méthode — et la volonté de montrer ce qu'on a écarté, pas
seulement ce qu'on a corrigé.</p>

<p>Voici exactement comment on a audité mindset-ctx cette semaine.</p>

<h2>La méthode : deux passes, pas une</h2>
<p>Une revue de sécurité en une seule passe a un biais structurel : la personne qui
trouve une piste a envie qu'elle soit réelle. Pour éviter ça, on a séparé les deux
rôles :</p>
<ul>
  <li><strong>Passe 1 — identification</strong> : lecture intégrale de chaque fichier
  sensible (authentification/session, paiements Stripe, webhooks GitHub/GitLab,
  rendu HTML et recherche), domaine par domaine, à la recherche de tout ce qui
  pourrait ressembler à une faille.</li>
  <li><strong>Passe 2 — démolition</strong> : chaque piste retenue passe devant un
  second examen dont le seul objectif est de la réfuter, en vérifiant si elle est
  réellement exploitable dans le déploiement réel du produit — pas dans une
  combinaison théorique de fonctionnalités qui n'existe nulle part en production.</li>
</ul>

<h2>Ce qu'on a trouvé, et pourquoi ça ne compte pas</h2>
<p>Six pistes ont été soulevées en passe 1. Aucune n'a survécu au seuil de confiance
retenu pour un rapport final. Deux exemples concrets de ce que "ne pas exagérer une
faille" veut dire en pratique :</p>

<p><strong>L'en-tête Host reflété dans un manifest GitHub App.</strong> Un attaquant
pourrait en théorie envoyer un en-tête <code>Host</code> falsifié. Mais cette route
n'est appelée que par l'opérateur lui-même, une seule fois, en visitant directement sa
propre URL pour une configuration initiale — personne d'autre ne peut forcer ce
scénario à distance. Piste réelle sur le papier, sans chemin d'exploitation
réaliste.</p>

<p><strong>Une comparaison de clé sans temps constant.</strong> Une incohérence de
style, oui : un endroit du code comparait une clé API avec <code>!==</code> au lieu du
comparateur à temps constant utilisé partout ailleurs. Mais l'extraction par attaque
temporelle sur un serveur HTTP classique reste théorique — le bruit réseau noie le
signal bien avant qu'un octet ne soit récupérable.</p>

<h2>Ce qu'on a corrigé quand même</h2>
<p>Aucune de ces pistes n'était une faille confirmée — mais deux corrections
d'hygiène ont été appliquées, parce qu'elles étaient bon marché et cohérentes avec
des motifs déjà établis dans le code : la comparaison de clé passée en temps
constant partout, et un plafond de taille ajouté sur un champ qui n'en avait pas
(évite qu'un appel non authentifié gonfle la facture de l'API tierce utilisée par le
chatbot support).</p>

<h2>Le standard qu'on applique à chaque fois</h2>
<p>Ce n'est pas la première revue de ce genre sur ce projet — une revue précédente
avait trouvé et corrigé trois vraies failles (CSRF sur un cookie de session,
login-CSRF sur le flux SSO, exécution shell non sécurisée dans l'extension VS Code).
Cette fois-ci, zéro faille confirmée. Les deux résultats sont publiés avec le même
niveau de détail — parce qu'un audit qui ne montre que ses succès n'est pas un audit,
c'est de la communication.</p>

<p>Open source, historique complet des commits et PRs visible : <a href="${REPO_URL}">${REPO_URL.replace("https://", "")}</a></p>
`,
  },
  {
    slug: "mcp-explique",
    title: "MCP expliqué : le protocole qui évite de recoder l'intégration pour chaque agent IA",
    date: "2026-07-18",
    excerpt:
      "Avant MCP, brancher vos données sur Claude, Cursor et Copilot voulait dire écrire trois intégrations différentes. Le protocole standardise ça — voici comment, et ce que ça change concrètement pour une équipe.",
    bodyHtml: `
<p>Avant le <strong>Model Context Protocol</strong> (MCP), donner à un agent IA accès à vos
données — un repo, une base de connaissances, un outil interne — voulait dire écrire une
intégration spécifique par agent : un plugin pour Claude, une extension pour Cursor, un
connecteur pour Copilot. Trois agents, trois codebases à maintenir, pour exposer
exactement la même chose trois fois.</p>

<p>MCP règle ce problème en standardisant l'interface plutôt que l'implémentation.</p>

<h2>Le principe : un serveur, n'importe quel client</h2>
<p>MCP définit un protocole client-serveur : un <strong>serveur MCP</strong> expose des
<em>outils</em> (des fonctions que l'agent peut appeler), des <em>ressources</em> (des
données qu'il peut lire) et des <em>prompts</em> (des templates réutilisables). N'importe
quel <strong>client MCP</strong> — Claude Code, Cursor, et tout agent qui parle le
protocole — peut s'y connecter et découvrir automatiquement ce qui est disponible, sans
code spécifique à cet agent.</p>

<p>L'analogie la plus proche : le <strong>Language Server Protocol</strong> a réglé le même
problème pour les éditeurs de code (un serveur de langage, n'importe quel éditeur
compatible) des années avant que les agents IA n'existent. MCP fait le même pari pour le
contexte et les outils.</p>

<h2>Concrètement, ça donne quoi</h2>
<p>mindset-ctx expose trois outils via MCP :</p>
<ul>
  <li><code>get_context</code> — lit un fichier de contexte (<code>CLAUDE.md</code>,
  <code>AGENTS.md</code>, architecture, prompts)</li>
  <li><code>search_memory</code> — recherche dans la mémoire du repo (commits, PRs, issues)</li>
  <li><code>analyze_repo</code> — analyse structurée et fraîche du repo</li>
</ul>

<p>Écrit une fois, utilisable tel quel dans Claude Code :</p>
<pre>claude mcp add mindset-ctx -- node /chemin/vers/dist/cli.js mcp /chemin/vers/repo</pre>

<p>Et dans Cursor, sans une ligne de code supplémentaire côté mindset-ctx — Cursor parle
MCP nativement. Il suffit de déclarer le serveur dans <code>.cursor/mcp.json</code> :</p>
<pre>{
  "mcpServers": {
    "mindset-ctx": {
      "command": "node",
      "args": ["/chemin/vers/dist/cli.js", "mcp", "/chemin/vers/repo"]
    }
  }
}</pre>

<p>Même serveur, zéro changement de code, deux agents différents qui appellent les mêmes
outils. C'est tout l'intérêt : la prochaine extension IA qui adopte MCP fonctionnera aussi,
sans rien reconstruire.</p>

<h2>Pourquoi ça compte pour une équipe</h2>
<p>Sans standard, le choix d'un agent IA engage une équipe sur son écosystème d'outils.
Avec MCP, le contexte et la mémoire d'un repo deviennent une brique indépendante du modèle
ou de l'éditeur — exactement la logique derrière la brique <strong>Gateway</strong> de
mindset-ctx : un seul serveur MCP, branché une fois, qui sert Claude Code, Cursor et tout
ce qui viendra ensuite.</p>

<pre>npm install -g mindset-ctx
ctx generate .
ctx mcp .</pre>

<p>Open source, sur GitHub : <a href="${REPO_URL}">${REPO_URL.replace("https://", "")}</a></p>
`,
  },
  {
    slug: "claude-md-vs-agents-md",
    title: "CLAUDE.md vs AGENTS.md : quelle différence, et faut-il les deux ?",
    date: "2026-07-17",
    excerpt:
      "Deux fichiers, deux écosystèmes d'agents IA, une même idée : donner du contexte projet avant que l'agent ne commence à coder. Voici ce qui les distingue et pourquoi la plupart des équipes finissent par maintenir les deux.",
    bodyHtml: `
<p>Ouvrez un repo qui utilise des agents IA aujourd'hui et vous tomberez probablement
sur l'un de ces deux fichiers à la racine : <code>CLAUDE.md</code> ou <code>AGENTS.md</code>.
Parfois les deux. La question revient souvent : est-ce redondant ?</p>

<h2>CLAUDE.md — le format de Claude Code</h2>
<p><code>CLAUDE.md</code> est le fichier de contexte lu automatiquement par
<strong>Claude Code</strong> (le CLI d'Anthropic) à chaque session : conventions de
code, commandes de build/test, architecture du repo, règles spécifiques à l'équipe.
C'est un fichier Markdown libre — pas de schéma imposé — que Claude Code charge et
traite comme une instruction système prioritaire.</p>

<h2>AGENTS.md — le format ouvert, multi-outils</h2>
<p><code>AGENTS.md</code> vise la même idée mais en <strong>format ouvert</strong>,
adopté par plusieurs outils (Cursor, Aider, et d'autres agents de code) qui ne sont
pas liés à un seul fournisseur. L'objectif : un seul fichier de contexte lisible par
n'importe quel agent qui respecte la convention, sans dépendre d'un outil précis.</p>

<h2>Pourquoi pas un seul fichier pour les deux ?</h2>
<p>En théorie, un contenu quasi identique suffirait aux deux. En pratique, deux raisons
poussent à les garder distincts :</p>
<ul>
  <li><strong>Priorité de lecture</strong> — certains outils lisent un fichier avant
  l'autre, ou ignorent celui qu'ils ne reconnaissent pas ; dupliquer garantit que
  chaque agent trouve son format attendu sans devoir deviner.</li>
  <li><strong>Dérive silencieuse</strong> — si un seul des deux fichiers est mis à jour
  après un changement d'architecture, l'agent qui lit l'autre travaille sur une
  version obsolète du projet sans que personne ne s'en aperçoive avant un bug ou une
  review ratée.</li>
</ul>

<p>Le vrai problème n'est donc pas "lequel choisir", mais <strong>comment garder les
deux synchronisés</strong> au fil des commits — sans que ce soit une tâche manuelle de
plus que l'équipe oublie de faire.</p>

<h2>C'est exactement ce que fait mindset-ctx</h2>
<p>mindset-ctx génère <code>CLAUDE.md</code> et <code>AGENTS.md</code> à partir de la
même analyse du repo, et les régénère à chaque push structurant — pas de copier-coller
manuel entre les deux, pas de fichier qui prend du retard sur l'autre.</p>

<pre>npm install -g mindset-ctx
ctx generate .</pre>

<p>Un seul run, deux fichiers de contexte à jour, quel que soit l'agent branché dessus.
Open source, sur GitHub : <a href="${REPO_URL}">${REPO_URL.replace("https://", "")}</a></p>
`,
  },
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

/** Every post's slug — used by sitemap.xml to list them without duplicating the post data. */
export function blogSlugs(): string[] {
  return POSTS.map((p) => p.slug);
}

/** Slug/title/excerpt for every post, newest first — used by llms.txt without duplicating the post data. */
export function blogPostsMeta(): { slug: string; title: string; excerpt: string }[] {
  return [...POSTS]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ slug, title, excerpt }) => ({ slug, title, excerpt }));
}

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
