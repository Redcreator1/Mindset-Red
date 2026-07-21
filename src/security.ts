import { shell, REPO_URL } from "./home.js";

/**
 * Public /security page — makes the project's security posture visible and
 * verifiable instead of leaving it buried in commits. Strict rule for this
 * file (same anti-overselling discipline as the pricing/legal copy, see
 * docs/VISION.md): every claim here must be literally true and checkable by
 * the reader today. No SOC 2, no third-party pentest, no certification we
 * don't have — the "What we don't claim" section says so out loud, because
 * an honest limit is more credible than an inflated badge.
 */

const SECURITY_STYLE = `
<style>
  main.sec { max-width: 760px; margin: 0 auto; padding: 32px 32px 64px; }
  main.sec h1 { font-size: 28px; margin: 8px 0 6px; }
  main.sec .updated { color: #64748b; font-size: 13px; margin: 0 0 28px; }
  main.sec h2 { font-size: 18px; margin: 34px 0 12px; color: #e2e8f0; }
  main.sec p, main.sec li { color: #cbd5e1; font-size: 14.5px; line-height: 1.7; }
  main.sec ul { padding-left: 20px; margin: 8px 0; }
  main.sec li { margin: 5px 0; }
  main.sec code { background: #1e293b; border-radius: 5px; padding: 1px 6px; font-size: .92em; }
  main.sec .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin: 24px 0 8px; }
  main.sec .fact { background: #111a2e; border: 1px solid #1e293b; border-radius: 12px; padding: 16px 18px; }
  main.sec .fact .n { font-size: 26px; font-weight: 800; color: #60a5fa; }
  main.sec .fact .l { color: #94a3b8; font-size: 13px; margin-top: 4px; }
  main.sec .verify { background: #0f1830; border: 1px solid #1e293b; border-left: 3px solid #2563eb;
    border-radius: 8px; padding: 12px 16px; margin: 12px 0; font-size: 13.5px; color: #93c5fd; }
  main.sec .verify code { background: #1e293b; color: #cbd5e1; }
  main.sec .limits { background: #111a2e; border: 1px solid #1e293b; border-radius: 12px; padding: 4px 22px 12px; margin-top: 12px; }
</style>`;

export function renderSecurity(baseUrl?: string): string {
  const body = `
${SECURITY_STYLE}
<main class="sec">
  <h1>Sécurité</h1>
  <p class="updated">Posture de sécurité de mindset-ctx — chaque affirmation ci-dessous est vérifiable publiquement.</p>

  <p>mindset-ctx est <strong>open source</strong> (licence MIT). Tout ce qui suit peut être
  vérifié par n'importe qui, directement dans le dépôt — c'est le principe : pas de
  promesse invérifiable, que du contrôlable.</p>

  <div class="facts">
    <div class="fact"><div class="n">150+</div><div class="l">tests automatisés, sur chaque push</div></div>
    <div class="fact"><div class="n">0</div><div class="l">vulnérabilité connue (npm&nbsp;audit)</div></div>
    <div class="fact"><div class="n">100%</div><div class="l">open source, MIT, auditable</div></div>
  </div>

  <h2>Le principe fondateur : votre code ne quitte jamais votre machine</h2>
  <p>L'analyse de votre code, la génération de contexte, la recherche mémoire et le serveur
  MCP tournent toujours en <strong>self-hosted</strong>, sur votre machine — sur tous les
  plans, gratuits comme payants. Ce n'est pas une option de configuration : l'offre
  hébergée (Cloudflare Workers) n'a tout simplement aucune route pour analyser un dépôt.
  Elle ne fait que la facturation, le compte et le suivi de quota. Votre code source n'est
  donc jamais transmis à nos serveurs — c'est une contrainte d'architecture, pas un
  réglage.</p>

  <h2>Tests et intégration continue</h2>
  <p>Plus de 150 tests automatisés couvrent l'authentification, la facturation, la
  vérification des webhooks, le rendu et la recherche. L'intégralité de la suite tourne en
  CI sur <strong>chaque push</strong>, sur Node 20 et 22 — une régression ne peut pas
  arriver en production sans casser le build d'abord.</p>
  <div class="verify">Vérifiez&nbsp;: onglet <em>Actions</em> du dépôt, ou <code>npm test</code> après un clone.</div>

  <h2>Dépendances</h2>
  <p>Une seule dépendance runtime (le SDK officiel Anthropic, utilisé uniquement par la
  génération enrichie optionnelle). <code>npm audit</code> retourne
  <strong>0 vulnérabilité</strong>. Quand une faille est apparue dans une dépendance
  transitive optionnelle, elle a été retirée proprement plutôt que corrigée par un
  downgrade non vérifié — la décision est documentée dans l'historique.</p>
  <div class="verify">Vérifiez&nbsp;: <code>npm audit</code> après un clone, ou l'onglet <em>Security</em> du dépôt.</div>

  <h2>Revues de sécurité</h2>
  <p>Le code passe des revues de sécurité régulières, selon une méthode en deux passes :
  une passe qui identifie les pistes, puis une seconde dont le seul rôle est de
  <em>démonter</em> chaque piste avant qu'elle ne soit retenue. Les vraies failles trouvées
  ont été corrigées ; les pistes non exploitables sont documentées avec la raison de leur
  rejet. Résultats publiés au même niveau de détail, qu'ils soient flatteurs ou non —
  <a href="/blog/comment-on-audite-mindset-ctx">la méthode est décrite ici</a>.</p>

  <h2>Contrôles techniques en place</h2>
  <ul>
    <li>Signatures de webhooks (Stripe, GitHub, GitLab) vérifiées en HMAC, comparaison à
    temps constant, tolérance anti-rejeu — un webhook non signé ou rejoué est refusé avant
    tout traitement.</li>
    <li>Cookies de session signés, <code>HttpOnly</code>, <code>Secure</code>,
    <code>SameSite=Strict</code> ; protection anti-CSRF (paramètre <code>state</code>) sur
    le flux de connexion SSO.</li>
    <li>La porte de paiement ne remet jamais de clé API avant confirmation du paiement par
    Stripe.</li>
    <li>Secrets (clés Stripe, Anthropic, WorkOS) toujours en variables d'environnement /
    secrets CI, jamais en dur dans le code.</li>
  </ul>

  <h2>Signaler un problème</h2>
  <p>Vous pensez avoir trouvé une faille&nbsp;? Ouvrez une issue sur le dépôt
  (<a href="${REPO_URL}">${REPO_URL.replace("https://", "")}</a>) ou écrivez-nous via
  <a href="/support">la page support</a>. Les rapports de sécurité sont traités en
  priorité.</p>

  <h2>Ce qu'on ne prétend pas (encore)</h2>
  <div class="limits">
    <p>Par honnêteté, voici ce que mindset-ctx n'a <strong>pas</strong> aujourd'hui&nbsp;: pas
    de certification SOC&nbsp;2, pas d'audit de pénétration par un tiers accrédité, pas de
    programme de bug bounty formel. Ce sont des étapes qui ont du sens à mesure que le
    volume de clients le justifie — les annoncer avant de les avoir serait exactement le
    genre de survente que ce projet s'interdit. Ce qui est listé plus haut est réel,
    présent aujourd'hui, et vérifiable&nbsp;; le reste viendra quand ce sera vrai.</p>
  </div>
</main>`;
  return shell({
    title: "Sécurité — mindset-ctx",
    description: "La posture de sécurité de mindset-ctx, chaque affirmation vérifiable publiquement : tests, dépendances, revues, contrôles.",
    body,
    baseUrl,
    path: "/security",
  });
}
