# mindset-ctx — Note de vision

> Enregistré le 12/07/2026 pour ne pas perdre le fil entre deux sessions. Version
> interactive (design, tableaux) : générée en artefact le même jour — ce fichier en
> est la version texte de référence, celle qui vit dans le repo.

## Le constat honnête

Anthropic, OpenAI, xAI vendent l'intelligence. mindset-ctx vend ce dont l'intelligence
a besoin pour bien travailler sur *votre* code : un contexte à jour, interrogeable,
indépendant du modèle branché dessus.

Cursor (Anysphere, fondé 2022) n'a jamais entraîné son propre modèle de fondation —
il tourne sur Claude/GPT, comme nous. Sa valorisation rapportée (~9 Md$ en 2025, presse
tech, à vérifier) vient de la possession d'une **expérience**, pas d'un modèle. Notre
équivalent : posséder la couche contexte, pas concurrencer les labos sur les modèles
(hors de portée financièrement, et pas notre pari).

## La catégorie qu'on possède

**"Infrastructure de contexte pour agents IA."** Pas un générateur de CLAUDE.md — une
brique que n'importe quel agent (Claude Code, Cursor, Copilot, les suivants) vient
consommer, indépendamment du modèle qui gagne le marché. On n'est adversaire de
personne ; fournisseur de tout le monde.

## Architecture produit (les briques, nommées)

| Brique | Rôle | Statut |
| --- | --- | --- |
| **Core** | Génération de contexte (CLAUDE.md, AGENTS.md, architecture, prompts) | En prod |
| **Memory** | Mémoire projet : git, PRs, issues — BM25, sémantique, RRF | En prod |
| **Gateway** | Passerelle MCP pour Claude Code / Cursor | En prod |
| **Ops** | Dashboard, tenants, quotas, facturation Stripe live | En prod |
| **Teams** | SSO, rôles, mémoire d'équipe partagée | Prochaine brique |
| **Rank** | Modèle de ranking propriétaire, fine-tuné sur du contexte code (pas un LLM — un petit modèle spécialisé, budget de quelques milliers de $, pas des centaines de millions) | Moat, plus tard |

## Marque & domaine

- **`mindset-ctx.dev`** disponible à 9,99 $/an au moment de l'écriture — déjà le nom
  utilisé dans le code (`buildAppManifest`). Achat prévu par l'utilisateur fin de
  semaine (12–18 juillet 2026).
- Structure cible : domaine racine = site vitrine + documentation (façon Stripe/Vercel) ;
  API reste sur son sous-domaine technique (le Worker Cloudflare actuel).
- Alternatives vérifiées disponibles : `mindsetctx.com` (11,25 $), `getmindset.dev`
  (9,99 $), `mindsetctx.ai` (160 $/2 ans — trop cher pour le gain marginal à ce stade).
  `mindset.dev` déjà pris.

## Feuille de route, brique par brique

- **Phase 0 — Fait** : fondation en prod (73 tests, CI verte, Cloudflare Workers,
  Stripe live, provisioning auto par install GitHub App, audit sécurité passé, repo
  public).
- **Phase 1 — Cette semaine (crédibilité)** : acheter le domaine, le brancher sur le
  Worker, site vitrine séparé du produit brut, documentation structurée (`/docs`).
- **Phase 2 — Ce mois-ci (profondeur produit)** : SSO/RBAC (Team/Enterprise), support
  GitLab/Bitbucket, déploiement dédié/VPC pour Enterprise (déjà promis sur `/pricing`,
  pas encore construit).
- **Phase 3 — Ce trimestre (écosystème)** : extension VS Code/JetBrains, intégrations
  Slack/Linear/Notion comme sources de mémoire, programme de referral.
- **Phase 4 — Moat technique** : modèle de ranking propriétaire fine-tuné sur du
  contexte code — la vraie réponse, réaliste, à "construire notre propre modèle".
- **Phase 5 — Aller-marché Enterprise** : études de cas, conformité (SOC 2 quand le
  volume le justifie), vraie page Enterprise avec contact commercial.

## Décisions prises

- **12/07/2026** — Domaine choisi : `mindset-ctx.dev`. Achat différé à la fin de la
  semaine (utilisateur), donc pas de travail de marque/branding tant que ce n'est pas
  acheté — focus code en attendant.
- **12/07/2026** — Première brique de la Phase 2 attaquée : **support GitLab**
  (ingestion mémoire PRs/issues), par choix de l'agent (Auto Mode) — ferme un vrai trou
  de roadmap, ne dépend pas d'un client Enterprise déjà signé, suit un pattern déjà
  éprouvé (`github.ts`). SSO/RBAC et déploiement dédié restent à prioriser ensuite.
