import { PLANS, type PlanId } from "./billing.js";
import { ogMeta, SUPPORT_EMAIL } from "./home.js";

/**
 * Public pricing page and self-service signup — the "front door" that lets
 * anyone on the internet subscribe without a pre-provisioned tenant key. The
 * flow is entirely automatic: click Buy → server mints a tenant key → Stripe
 * Checkout → payment → subscription.created webhook activates the plan.
 * No manual step in the loop.
 */

interface PricingCard {
  plan: PlanId;
  price: string;
  interval?: string;
  features: string[];
  cta: string;
  primary: boolean;
}

// Feature lists describe only what each plan mechanically delivers today —
// no aspirational copy. The hosted Worker (mindsetctx.com) is billing +
// dashboard + quota only: it has no route to analyze a repo, search memory,
// or serve MCP (Cloudflare Workers can't run git or hold a repo clone). That
// heavy lifting always runs in the self-hosted CLI, free and unlimited on
// every plan including Free — a paying plan buys a hosted account (key,
// dashboard, tracked quota) and, on Team, pooled multi-seat billing. See
// docs/VISION.md's 18/07/2026 entry for why this was rewritten.
const CARDS: PricingCard[] = [
  { plan: "free", price: "0 €", features: ["1 repo", "200 requêtes/jour (compte hébergé)", "Self-hosted illimité", "BM25 + MCP local"], cta: "Utiliser gratuitement", primary: false },
  { plan: "pro", price: "19 €", interval: "mois", features: ["5 000 requêtes/jour (compte hébergé)", "Dashboard hébergé : quotas & usage en temps réel", "CLI self-hosted illimitée — génération, recherche, MCP"], cta: "Passer Pro", primary: true },
  { plan: "team", price: "99 €", interval: "mois", features: ["50 000 requêtes/jour (quota partagé par l'équipe)", "Multi-sièges : invitez votre équipe, rôles owner/member", "Dashboard hébergé scopé à l'équipe", "CLI self-hosted illimitée pour chaque membre"], cta: "Passer Team", primary: false },
  { plan: "enterprise", price: "Sur devis", features: ["Instance dédiée / VPC (Docker, docs/DEPLOYMENT.md)", "Quotas illimités", "SLA à discuter", "SSO Entreprise (WorkOS AuthKit)"], cta: "Nous contacter", primary: false },
];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Render the /pricing page — public, no auth needed. */
export function renderPricing(opts: { baseUrl: string; availablePlans: Set<PlanId> }): string {
  const cards = CARDS.map((c) => {
    const enabled = c.plan === "free" || opts.availablePlans.has(c.plan);
    const href = c.plan === "free"
      ? "https://github.com/Redcreator1/Mindset-Red#readme"
      : c.plan === "enterprise"
      ? `mailto:${SUPPORT_EMAIL}?subject=mindset-ctx%20Enterprise`
      : `/v1/signup?plan=${c.plan}`;
    const disabled = !enabled && c.plan !== "free" && c.plan !== "enterprise";
    return `
    <div class="card ${c.primary ? "primary" : ""}">
      <h3>${esc(PLANS[c.plan].name)}</h3>
      <div class="price"><span class="amount">${esc(c.price)}</span>${c.interval ? `<span class="int">/${esc(c.interval)}</span>` : ""}</div>
      <ul>${c.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      ${disabled
        ? `<button class="cta" disabled title="Configure STRIPE_PRICE_MAP for this plan">${esc(c.cta)} (indisponible)</button>`
        : `<a class="cta" href="${esc(href)}">${esc(c.cta)}</a>`}
    </div>`;
  }).join("");

  return `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>mindset-ctx — Tarifs</title>
${ogMeta({
    title: "mindset-ctx — Tarifs",
    description: "Free, Pro, Team, Enterprise — le contexte pour vos agents IA, self-hosted gratuit ou hébergé avec dashboard et quotas.",
    baseUrl: opts.baseUrl,
    path: "/pricing",
  })}
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #0b1220; color: #e2e8f0; }
  header { padding: 48px 32px 24px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 32px; }
  .sub { color: #94a3b8; max-width: 640px; margin: 0 auto; }
  main { padding: 32px; max-width: 1200px; margin: 0 auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
  .card { background: #111a2e; border: 1px solid #1e293b; border-radius: 14px; padding: 24px;
    display: flex; flex-direction: column; }
  .card.primary { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
  h3 { margin: 0 0 12px; font-size: 18px; }
  .price { margin-bottom: 20px; }
  .amount { font-size: 34px; font-weight: 700; }
  .int { color: #94a3b8; font-size: 15px; }
  ul { list-style: none; padding: 0; margin: 0 0 24px; flex: 1; }
  li { padding: 6px 0; color: #cbd5e1; border-bottom: 1px solid #1e293b; }
  li:last-child { border-bottom: none; }
  .cta { display: block; text-align: center; background: #1e293b; color: #e2e8f0;
    padding: 12px 16px; border-radius: 10px; text-decoration: none; font-weight: 600;
    border: none; cursor: pointer; font-size: 15px; }
  .card.primary .cta { background: #2563eb; }
  .cta:hover { filter: brightness(1.15); }
  .cta:disabled { opacity: .5; cursor: not-allowed; }
  footer { padding: 32px; text-align: center; color: #475569; font-size: 13px; }
  footer a { color: #64748b; }
</style></head>
<body>
<header>
  <h1>mindset-ctx</h1>
  <p class="sub">Context-as-a-Service pour vos repos. Zéro configuration, MCP-native pour Claude Code et Cursor. Votre code reste chez vous.</p>
</header>
<main><div class="grid">${cards}</div></main>
<footer>
  Repos privés → <strong>self-hosted, votre code ne quitte jamais votre machine.</strong><br>
  Pro/Team : 14 jours satisfait ou remboursé. <a href="/terms">CGV</a> · <a href="/privacy">Confidentialité</a><br>
  <a href="https://github.com/Redcreator1/Mindset-Red">GitHub</a> · <a href="/v1/dashboard">Dashboard</a> · <a href="/support">Support</a>
</footer>
</body></html>`;
}

/** Success page after Stripe returns — pure confirmation, no auth. */
export function renderSuccess(tenantKey: string, baseUrl = ""): string {
  // With no baseUrl the example degrades to a relative path, still copy-paste
  // adaptable; with one (the Worker always passes it) it's runnable as-is.
  const apiBase = baseUrl.replace(/\/+$/, "");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><title>Bienvenue — mindset-ctx</title>
<style>
  body { margin:0; font: 15px/1.5 -apple-system, system-ui, sans-serif;
    background: #0b1220; color: #e2e8f0; padding: 48px 32px; }
  main { max-width: 640px; margin: 0 auto; background: #111a2e;
    border: 1px solid #1e293b; border-radius: 14px; padding: 32px; }
  h1 { margin: 0 0 16px; }
  code { background: #0b1220; padding: 8px 12px; border-radius: 6px; display: block;
    word-break: break-all; font-family: ui-monospace, "SF Mono", Menlo, monospace; margin: 8px 0 20px; }
  .warn { color: #fbbf24; font-size: 13px; }
</style></head>
<body><main>
  <h1>✅ Paiement validé</h1>
  <p>Merci ! Votre abonnement est activé. Voici votre clé API :</p>
  <code>${esc(tenantKey)}</code>
  <p class="warn">Copiez-la maintenant — elle ne sera plus jamais affichée.</p>
  <p>Utilisation — vérifiez votre quota :</p>
  <code>curl -H "Authorization: Bearer ${esc(tenantKey)}" ${esc(apiBase)}/v1/usage</code>
  <p>Votre <a href="${esc(apiBase)}/v1/dashboard?key=${esc(encodeURIComponent(tenantKey))}">dashboard</a> est accessible avec cette même clé (le lien ci-dessus fonctionne directement). Pour le self-hosted et l'intégration Claude Code (MCP) : voir <a href="https://github.com/Redcreator1/Mindset-Red">la doc</a>.</p>
  <p style="color:#94a3b8;font-size:13px">Un souci ? <a href="${esc(apiBase)}/support">Contactez le support</a> — remboursement possible sous 14 jours, voir les <a href="${esc(apiBase)}/terms">CGV</a>.</p>
</main></body></html>`;
}

/**
 * Confirmation page after a GitHub App install — the trust moment where a
 * customer has just granted a third party read access to their private
 * repos. Distinct copy from renderSuccess() on purpose: no payment happened
 * here, and the page needs to reassure (scope, revocability) rather than
 * just hand over a key.
 */
export function renderAppInstalled(opts: { tenantKey: string; account: string; repos: string[] | "*" }): string {
  const repoList = opts.repos === "*"
    ? "<li>Tous les repos actuels et futurs de ce compte</li>"
    : opts.repos.map((r) => `<li><code class="inline">${esc(r)}</code></li>`).join("");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><title>Installation confirmée — mindset-ctx</title>
<style>
  body { margin:0; font: 15px/1.5 -apple-system, system-ui, sans-serif;
    background: #0b1220; color: #e2e8f0; padding: 48px 32px; }
  main { max-width: 640px; margin: 0 auto; background: #111a2e;
    border: 1px solid #1e293b; border-radius: 14px; padding: 32px; }
  h1 { margin: 0 0 16px; font-size: 22px; }
  h2 { margin: 28px 0 8px; font-size: 14px; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em; }
  code { background: #0b1220; padding: 8px 12px; border-radius: 6px; display: block;
    word-break: break-all; font-family: ui-monospace, "SF Mono", Menlo, monospace; margin: 8px 0 20px; }
  code.inline { display: inline; padding: 2px 6px; margin: 0; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 6px 0; border-bottom: 1px solid #1e293b; }
  li:last-child { border-bottom: none; }
  .scope { background: #0f2e1c; border: 1px solid #14532d; border-radius: 10px; padding: 14px 16px; font-size: 13px; color: #86efac; }
  .warn { color: #fbbf24; font-size: 13px; }
  a { color: #60a5fa; }
</style></head>
<body><main>
  <h1>✅ mindset-ctx est installé sur <strong>${esc(opts.account)}</strong></h1>
  <p class="scope">🔒 Accès en <strong>lecture seule</strong> (contenu, issues, pull requests) — jamais d'écriture sur vos repos. Révocable à tout moment depuis <a href="https://github.com/settings/installations">github.com/settings/installations</a>.</p>

  <h2>Repos accordés</h2>
  <ul>${repoList}</ul>

  <h2>Votre clé API</h2>
  <code>${esc(opts.tenantKey)}</code>
  <p class="warn">Copiez-la maintenant — elle ne sera plus jamais affichée.</p>

  <h2>Utilisation</h2>
  <code>curl -H "Authorization: Bearer ${esc(opts.tenantKey)}" https://VOTRE-HOTE/v1/repos</code>
  <p>Ou dans Claude Code (MCP) : voir <a href="https://github.com/Redcreator1/Mindset-Red">la doc</a>. Vous démarrez sur le plan gratuit — passez sur <a href="/pricing">/pricing</a> pour plus de quota.</p>
</main></body></html>`;
}
