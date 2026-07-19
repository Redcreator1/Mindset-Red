import { shell, SUPPORT_EMAIL } from "./home.js";

/**
 * Support chat: answers common questions grounded in a hand-written
 * knowledge base (SUPPORT_KNOWLEDGE below), never the model's own guesses
 * about the product — same discipline as the rest of the site after the
 * 18/07/2026 marketing-honesty fix (see docs/VISION.md). Talks to the
 * Anthropic Messages API over plain fetch, not the SDK, so the exact same
 * code runs on both server.ts (Node) and worker/index.ts (Cloudflare
 * Workers) — the same portability reasoning as checkout.ts/workos.ts.
 *
 * Escalation is deliberately NOT an automated email send: that would need a
 * transactional email provider (new service, new API key, a cost line) for
 * a problem that a `mailto:` link already solves with zero new
 * infrastructure. The chat page always offers a pre-filled mailto to
 * ${SUPPORT_EMAIL} — the visitor's own mail client sends it, so the founder
 * always sees the real message, not a summary a bot decided to forward.
 */

const KNOWLEDGE_VERSION = "2026-07-19";

export const SUPPORT_KNOWLEDGE = `
# mindset-ctx — base de connaissance support (${KNOWLEDGE_VERSION})

## Ce qu'est le produit
Infrastructure de contexte pour agents IA. Génère et maintient CLAUDE.md, AGENTS.md,
docs/ARCHITECTURE.md, CONTRIBUTING.md et .context/prompts.md à partir de l'analyse
réelle d'un repo. Indexe l'historique (commits, PRs, issues) dans une mémoire
interrogeable (BM25, recherche sémantique, fusion RRF). Expose tout ça via MCP
(Model Context Protocol) pour Claude Code et Cursor.

## La distinction la plus importante : hébergé vs self-hosted
- Self-hosted (gratuit, tous les plans, y compris Free) : "npm install -g mindset-ctx"
  fait tourner l'outil sur la machine de l'utilisateur. C'est LÀ que se fait le vrai
  travail — analyse du repo, génération de contexte, recherche mémoire, serveur MCP.
  Le code source ne quitte jamais la machine de l'utilisateur.
- Hébergé (payant sur mindsetctx.com, plans Pro/Team/Enterprise) : un compte, une clé
  API, un tableau de bord (/v1/dashboard) et un suivi de quota. Le service hébergé ne
  fait PAS lui-même l'analyse de repo — Cloudflare Workers ne peut ni cloner ni lire un
  dépôt git. Toujours besoin du CLI self-hosted pour le vrai travail.

## Installation et premiers pas
1. npm install -g mindset-ctx
2. ctx generate .        (génère CLAUDE.md, AGENTS.md, architecture, prompts)
3. ctx index .            (indexe l'historique git dans la mémoire)
4. ctx mcp .              (lance le serveur MCP en stdio pour Claude Code/Cursor)
Enregistrement Claude Code : claude mcp add mindset-ctx -- node <chemin>/dist/cli.js mcp <repo>
Cursor : ajouter dans .cursor/mcp.json un serveur "command": "node", "args": [...].

## Plans et tarifs (voir /pricing, qui fait foi en cas de doute)
- Free : 0€, 1 repo / 200 requêtes par jour côté compte hébergé, self-hosted illimité.
- Pro : 19€/mois, 5000 requêtes/jour (compte hébergé), dashboard hébergé.
- Team : 99€/mois, 50000 requêtes/jour partagées, multi-sièges (owner/member).
- Enterprise : sur devis, instance dédiée / VPC (Docker), SSO Entreprise (WorkOS).

## Facturation et remboursement (voir /terms, qui fait foi en cas de doute)
Facturation mensuelle automatique via Stripe. Résiliable à tout moment (arrête le
renouvellement, pas de remboursement au prorata après le délai ci-dessous).
Remboursement intégral sous 14 jours après le premier prélèvement sur Pro/Team, sans
justification, en écrivant au support.

## Récupérer ou perdre sa clé API
La clé API s'affiche une seule fois : juste après le paiement (page de succès Stripe),
ou juste après l'installation de la GitHub App (/v1/app/installed). Si elle est perdue,
il n'y a pas d'auto-régénération : il faut contacter le support.

## Vie privée (voir /privacy, qui fait foi en cas de doute)
Le service hébergé ne collecte jamais le code source ni le contenu des requêtes de
recherche — seulement compte, clé, plan, et un compteur d'usage quotidien. Les
paiements sont traités par Stripe (jamais de numéro de carte chez nous).
Sous-traitants : Stripe, Cloudflare, et WorkOS si SSO Entreprise est utilisé.

## Rank ML
La brique de reranking par modèle entraîné (Rank ML) existe dans le code mais est
actuellement mise en pause par choix produit — pas une panne.

## Ce que ce bot ne sait pas faire
Ce chat ne peut ni modifier un compte, ni déclencher un remboursement, ni voir les
données personnelles d'un client — il répond aux questions générales sur le produit.
Pour tout ce qui touche à un compte précis, orienter vers le contact humain.
`.trim();

const SYSTEM_PROMPT = `Tu es l'assistant support de mindset-ctx, en français, ton direct et honnête.
Réponds UNIQUEMENT à partir de la base de connaissance fournie ci-dessous — n'invente
jamais de fonctionnalité, de prix, de délai ou de politique qui n'y figure pas.
Si la question sort de ce que tu sais, ou touche à un compte précis (facture, clé
perdue, remboursement à traiter), dis-le clairement et invite à contacter le support
humain plutôt que de deviner. Réponses courtes (3-5 phrases), pas de markdown, pas de
salutations superflues.

BASE DE CONNAISSANCE :
${SUPPORT_KNOWLEDGE}`;

export interface SupportChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_QUESTION_LENGTH = 1500;
const MAX_HISTORY_MESSAGES = 8;

export class SupportChatError extends Error {}

/**
 * Ask the support bot one question, with optional prior turns for context.
 * Plain REST call (no SDK) — works unmodified on Node and Workers.
 */
export async function askSupportBot(opts: {
  apiKey: string;
  question: string;
  history?: SupportChatMessage[];
  baseURL?: string;
  model?: string;
}): Promise<string> {
  const question = opts.question.trim();
  if (!question) throw new SupportChatError("empty question");
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new SupportChatError(`question too long (max ${MAX_QUESTION_LENGTH} characters)`);
  }

  const history = (opts.history ?? []).slice(-MAX_HISTORY_MESSAGES);
  const base = (opts.baseURL ?? "https://api.anthropic.com").replace(/\/+$/, "");

  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      // Haiku: fast and cheap, appropriate for grounded FAQ-style answers on
      // a public, unauthenticated endpoint — not the reasoning-heavy Opus
      // used for the occasional `ctx generate --ai` narrative in ai.ts.
      model: opts.model ?? "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [...history, { role: "user", content: question }],
    }),
  });
  if (!res.ok) {
    throw new SupportChatError(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new SupportChatError("empty response from the model");
  return text;
}

/** The /support page: a small chat widget, plus a mailto escalation that's always available. */
export function renderSupport(baseUrl?: string): string {
  const body = `
<style>
  main.support { max-width: 640px; margin: 0 auto; padding: 32px 32px 64px; }
  main.support h1 { font-size: 26px; margin: 8px 0 6px; }
  main.support > p.lede { color: #94a3b8; margin: 0 0 28px; }
  #chat { background: #111a2e; border: 1px solid #1e293b; border-radius: 14px; padding: 18px; }
  #log { display: flex; flex-direction: column; gap: 12px; min-height: 120px; margin-bottom: 14px; }
  .msg { padding: 10px 14px; border-radius: 10px; font-size: 14.5px; line-height: 1.55; max-width: 88%; white-space: pre-wrap; }
  .msg.user { align-self: flex-end; background: #2563eb; color: #fff; }
  .msg.bot { align-self: flex-start; background: #0b1220; border: 1px solid #1e293b; color: #e2e8f0; }
  .msg.error { align-self: flex-start; background: #2e1414; border: 1px solid #531e1e; color: #fca5a5; }
  form { display: flex; gap: 8px; }
  input[type=text] { flex: 1; background: #0b1220; border: 1px solid #1e293b; border-radius: 8px;
    color: #e2e8f0; padding: 10px 12px; font-size: 14.5px; }
  input[type=text]:focus { outline: 2px solid #2563eb; outline-offset: 1px; }
  button { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 10px 18px;
    font-weight: 600; font-size: 14.5px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .escalate { margin-top: 20px; padding: 16px 18px; background: #0f1830; border: 1px solid #1e3a8a;
    border-radius: 10px; font-size: 13.5px; color: #cbd5e1; }
  .escalate a { color: #93c5fd; font-weight: 600; }
  .unavailable { color: #d4a24c; font-size: 14px; }
</style>
<main class="support">
  <h1>Support</h1>
  <p class="lede">Posez votre question — l'assistant répond à partir de ce qu'on sait vraiment sur mindset-ctx, pas d'inventions. Pour tout ce qui touche à votre compte, écrivez-nous directement.</p>

  <div id="chat">
    <div id="log"></div>
    <form id="form">
      <input id="q" type="text" maxlength="${MAX_QUESTION_LENGTH}" placeholder="Comment fonctionne le remboursement ?" autocomplete="off" required>
      <button type="submit" id="send">Envoyer</button>
    </form>
    <p id="unavailable" class="unavailable" hidden>Le chat automatique n'est pas configuré ici — écrivez-nous directement, voir ci-dessous.</p>
  </div>

  <div class="escalate">
    Toujours pas la réponse ? <a id="mailto-link" href="mailto:${SUPPORT_EMAIL}">Écrivez-nous à ${SUPPORT_EMAIL}</a> — un humain vous répond, votre message part directement depuis votre messagerie.
  </div>
</main>
<script>
(function () {
  var log = document.getElementById("log");
  var form = document.getElementById("form");
  var input = document.getElementById("q");
  var send = document.getElementById("send");
  var unavailable = document.getElementById("unavailable");
  var mailtoLink = document.getElementById("mailto-link");
  var history = [];

  function addMsg(role, text) {
    var div = document.createElement("div");
    div.className = "msg " + role;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function updateMailto() {
    var transcript = history.map(function (m) { return (m.role === "user" ? "Moi: " : "Bot: ") + m.content; }).join("\\n\\n");
    var body = transcript ? "Bonjour,\\n\\nSuite à cette conversation avec le chat support :\\n\\n" + transcript + "\\n\\nMon problème : " : "Bonjour,\\n\\n";
    mailtoLink.href = "mailto:${SUPPORT_EMAIL}?subject=" + encodeURIComponent("Support mindset-ctx") + "&body=" + encodeURIComponent(body);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    addMsg("user", q);
    history.push({ role: "user", content: q });
    updateMailto();
    input.value = "";
    input.disabled = true;
    send.disabled = true;

    fetch("/v1/support/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: q, history: history.slice(0, -1) }),
    })
      .then(function (res) {
        if (res.status === 503) { unavailable.hidden = false; throw new Error("unavailable"); }
        if (!res.ok) throw new Error("chat failed");
        return res.json();
      })
      .then(function (data) {
        addMsg("bot", data.answer);
        history.push({ role: "assistant", content: data.answer });
        updateMailto();
      })
      .catch(function () {
        addMsg("error", "Le chat a rencontré un problème — écrivez-nous directement ci-dessous.");
      })
      .finally(function () {
        input.disabled = false;
        send.disabled = false;
        input.focus();
      });
  });
})();
</script>`;
  return shell({
    title: "Support — mindset-ctx",
    description: "Une question sur mindset-ctx ? Posez-la, ou écrivez-nous directement.",
    body,
    baseUrl,
    path: "/support",
  });
}
