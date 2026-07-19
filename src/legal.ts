import { shell, REPO_URL, SUPPORT_EMAIL } from "./home.js";

/**
 * Terms of Service and Privacy Policy — public, no auth. Written to describe
 * only what the product actually does today (same discipline as the
 * 18/07/2026 pricing-copy fix, see docs/VISION.md): the hosted service is
 * billing + dashboard + quota, self-hosted does the repo work and never
 * transmits code. Sections marked [À COMPLÉTER] need the operator's real
 * legal-entity details before this is a binding document — this is a solid
 * starting draft, not a substitute for legal review.
 */

const LEGAL_STYLE = `
<style>
  main.legal { max-width: 720px; margin: 0 auto; padding: 32px 32px 64px; }
  main.legal h1 { font-size: 26px; margin: 8px 0 4px; }
  main.legal .updated { color: #64748b; font-size: 13px; margin: 0 0 32px; }
  main.legal h2 { font-size: 17px; margin: 32px 0 10px; color: #e2e8f0; }
  main.legal p, main.legal li { color: #cbd5e1; font-size: 14.5px; line-height: 1.7; }
  main.legal ul { padding-left: 20px; margin: 8px 0; }
  main.legal li { margin: 4px 0; }
  main.legal .todo { background: #2e2410; border: 1px solid #533f14; border-radius: 8px;
    padding: 2px 8px; color: #d4a24c; font-size: .9em; font-weight: 600; }
  main.legal .box { background: #111a2e; border: 1px solid #1e293b; border-radius: 10px;
    padding: 16px 20px; margin: 16px 0; }
</style>`;

const TODO_ENTITY = `<span class="todo">[RAISON SOCIALE À COMPLÉTER]</span>`;
const TODO_ADDRESS = `<span class="todo">[ADRESSE À COMPLÉTER]</span>`;
const TODO_VAT = `<span class="todo">[NUMÉRO D'ENTREPRISE / TVA — SI APPLICABLE]</span>`;
const TODO_LAW = `<span class="todo">[DROIT APPLICABLE ET JURIDICTION — À COMPLÉTER]</span>`;

export function renderTerms(baseUrl?: string): string {
  const body = `
${LEGAL_STYLE}
<main class="legal">
  <h1>Conditions Générales de Vente</h1>
  <p class="updated">Dernière mise à jour : 19/07/2026</p>

  <div class="box">
    Édité par ${TODO_ENTITY}, ${TODO_ADDRESS} ${TODO_VAT}.
    Contact : <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
  </div>

  <h2>1. Objet</h2>
  <p>Les présentes CGV encadrent l'utilisation de <strong>mindset-ctx</strong>, un service d'infrastructure de contexte pour agents IA (génération de fichiers de contexte, mémoire de projet interrogeable, passerelle MCP), proposé à la fois en logiciel open source auto-hébergé et en offre hébergée payante sur <code>mindsetctx.com</code>.</p>

  <h2>2. Description du service — ce qui est hébergé, ce qui ne l'est pas</h2>
  <p>Deux modes distincts, à ne pas confondre :</p>
  <ul>
    <li><strong>Self-hosted (gratuit, tous les plans)</strong> — le logiciel (<code>npm install -g mindset-ctx</code>) tourne sur votre machine. L'analyse de votre code, la génération de contexte, la recherche dans la mémoire et le serveur MCP s'exécutent localement ; aucun code source n'est jamais transmis à mindset-ctx.</li>
    <li><strong>Hébergé (payant, plans Pro/Team/Enterprise)</strong> — un compte, une clé API, un tableau de bord et un suivi de quota hébergés sur notre infrastructure (Cloudflare Workers). L'offre hébergée ne réalise pas elle-même l'analyse de votre code : cette partie reste toujours exécutée en self-hosted, avec la clé fournie.</li>
  </ul>
  <p>Le détail exact de chaque plan est publié sur <a href="/pricing">/pricing</a> et fait foi.</p>

  <h2>3. Abonnements et facturation</h2>
  <p>Les plans Pro et Team sont facturés mensuellement, par prélèvement automatique via Stripe, notre prestataire de paiement. L'abonnement se renouvelle automatiquement chaque mois jusqu'à résiliation. Le plan Enterprise fait l'objet d'un devis et d'une facturation séparée.</p>
  <p>Vous pouvez résilier à tout moment depuis votre espace Stripe (lien fourni à l'achat) ou en nous contactant à <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> — la résiliation prend effet à la fin de la période déjà payée, sans reconduction.</p>

  <h2>4. Politique de remboursement</h2>
  <p><strong>Satisfait ou remboursé sous 14 jours</strong> à compter du premier prélèvement sur un plan Pro ou Team : écrivez-nous à <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>, remboursement intégral sans justification à fournir. Passé ce délai, les mois déjà prélevés ne sont pas remboursés, mais l'abonnement reste résiliable à tout moment pour arrêter tout prélèvement futur.</p>

  <h2>5. Compte et clé API</h2>
  <p>Votre clé API vous identifie et donne accès à votre compte et à votre quota. Elle vous est montrée une seule fois à la création — gardez-la secrète comme un mot de passe. Vous êtes responsable de son usage ; contactez-nous immédiatement en cas de compromission pour que nous la révoquions.</p>

  <h2>6. Propriété intellectuelle</h2>
  <p>Le code de mindset-ctx est open source, publié sous licence MIT : <a href="${REPO_URL}">${REPO_URL.replace("https://", "")}</a>. Le contenu que vous générez sur vos propres repos (fichiers de contexte, index de mémoire) vous appartient intégralement — nous n'y avons aucun accès en mode self-hosted, et l'offre hébergée ne le stocke pas.</p>

  <h2>7. Disponibilité et responsabilité</h2>
  <p>Le service hébergé est fourni "en l'état", sans garantie de disponibilité continue. En mode self-hosted, mindset-ctx n'a par construction aucun accès à votre code ni à vos données — notre responsabilité ne saurait donc être engagée sur leur contenu ou leur traitement dans ce mode.</p>

  <h2>8. Droit applicable</h2>
  <p>${TODO_LAW}</p>

  <h2>9. Contact</h2>
  <p>Pour toute question sur ces CGV : <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
</main>`;
  return shell({
    title: "Conditions Générales de Vente — mindset-ctx",
    description: "Abonnements, facturation, remboursement et responsabilité pour mindset-ctx.",
    body,
    baseUrl,
    path: "/terms",
  });
}

export function renderPrivacy(baseUrl?: string): string {
  const body = `
${LEGAL_STYLE}
<main class="legal">
  <h1>Politique de confidentialité</h1>
  <p class="updated">Dernière mise à jour : 19/07/2026</p>

  <div class="box">
    Responsable du traitement : ${TODO_ENTITY}, ${TODO_ADDRESS} ${TODO_VAT}.
    Contact : <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
  </div>

  <h2>1. Le principe : votre code n'est jamais collecté</h2>
  <p>En mode self-hosted (tous les plans, y compris gratuit), mindset-ctx s'exécute sur votre machine. Aucune ligne de votre code source, aucun fichier de votre repo n'est jamais transmis à nos serveurs — c'est une contrainte d'architecture, pas une simple promesse.</p>

  <h2>2. Ce que nous collectons réellement (compte hébergé)</h2>
  <p>Pour faire fonctionner un compte hébergé (plans Pro/Team/Enterprise, ou connexion SSO Entreprise), nous stockons dans notre base (Cloudflare KV) :</p>
  <ul>
    <li>votre clé API et le nom associé à votre compte ;</li>
    <li>votre adresse email, si vous vous connectez via SSO (WorkOS AuthKit) ;</li>
    <li>votre plan d'abonnement et votre compteur d'usage quotidien (nombre de requêtes, pas leur contenu) ;</li>
    <li>si vous êtes en équipe (Team) : le rôle (owner/membre) et l'appartenance à l'organisation.</li>
  </ul>
  <p>Nous ne collectons ni ne stockons le contenu de vos repos, vos requêtes de recherche, ni le contenu généré (CLAUDE.md, AGENTS.md, etc.) — ces opérations tournent en self-hosted, hors de notre infrastructure.</p>

  <h2>3. Paiement</h2>
  <p>Les paiements sont traités intégralement par <a href="https://stripe.com/fr/privacy">Stripe</a>. Nous ne recevons et ne stockons jamais votre numéro de carte bancaire.</p>

  <h2>4. Cookies</h2>
  <p>Un seul cookie fonctionnel est utilisé, uniquement si vous vous connectez via SSO Entreprise : un cookie de session signé (<code>ctx_session</code>, <code>HttpOnly</code>, <code>Secure</code>) qui vous garde connecté, et un cookie temporaire anti-CSRF pendant la connexion (<code>ctx_oauth_state</code>, supprimé aussitôt après). Aucun cookie publicitaire, aucun traceur tiers, aucun script d'analytics.</p>

  <h2>5. Sous-traitants</h2>
  <ul>
    <li><strong>Cloudflare</strong> — hébergement de l'infrastructure et de la base de comptes.</li>
    <li><strong>Stripe</strong> — traitement des paiements.</li>
    <li><strong>WorkOS</strong> — authentification SSO, uniquement si vous l'utilisez.</li>
  </ul>

  <h2>6. Vos droits</h2>
  <p>Vous pouvez demander l'accès, la rectification ou la suppression de vos données de compte hébergé à tout moment en écrivant à <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. Les données sont conservées tant que votre compte est actif, et supprimées dans un délai raisonnable après résiliation, sauf obligation légale de conservation.</p>

  <h2>7. Droit applicable</h2>
  <p>${TODO_LAW}</p>
</main>`;
  return shell({
    title: "Politique de confidentialité — mindset-ctx",
    description: "Ce que mindset-ctx collecte réellement, et ce qu'il ne collecte jamais (votre code).",
    body,
    baseUrl,
    path: "/privacy",
  });
}
