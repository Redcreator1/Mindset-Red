# mindset-ctx — Note de vision

> Enregistré le 14/07/2026 pour ne pas perdre le fil entre deux sessions. Version
> interactive (design, tableaux) : générée en artefact le même jour — ce fichier en
> est la version texte de référence, celle qui vit dans le repo.
>
> **19/07/2026** — Le journal détaillé des décisions (raisonnement complet,
> arbitrages, failles trouvées, négociations) a été déplacé hors de ce repo
> public vers un document privé, pour ne pas exposer le raisonnement
> stratégique complet à côté du code. Ce fichier garde le positionnement
> produit — déjà public par nature (site, README, pricing) — pas le "pourquoi"
> détaillé au jour le jour. Pour l'historique technique du code, voir
> `docs/ARCHITECTURE.md` et l'historique git normal (commits, PRs).

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
| **Teams** | SSO, rôles, mémoire d'équipe partagée | En prod |
| **Rank** | Modèle de ranking propriétaire, fine-tuné sur du contexte code (pas un LLM — un petit modèle spécialisé, budget de quelques milliers de $, pas des centaines de millions) | Moat, en cours |

## Feuille de route, brique par brique

- **Phase 0 — Fait** : fondation en prod (145+ tests, CI verte, Cloudflare Workers,
  Stripe live, provisioning auto par install GitHub App, audit sécurité passé, repo
  public).
- **Phase 1 — Fait** : domaine acheté et branché, site vitrine séparé du produit
  brut, documentation structurée (`/docs`).
- **Phase 2 — Fait** : SSO/RBAC (Team/Enterprise), support GitLab/Bitbucket,
  déploiement dédié/VPC pour Enterprise.
- **Phase 3 — En cours (écosystème)** : extension VS Code publiée ; JetBrains,
  intégrations Slack/Linear/Notion comme sources de mémoire, programme de
  referral restent à construire.
- **Phase 4 — Moat technique** : Rank v0 (heuristique) livré, Rank ML
  (cross-encoder fine-tuné) en cours de vérification.
- **Phase 5 — Aller-marché Enterprise** : études de cas, conformité (SOC 2 quand le
  volume le justifie), vraie page Enterprise avec contact commercial — pas
  encore attaqué.

## Décisions et journal détaillé

Le raisonnement complet (pourquoi tel prix, quelles failles ont été trouvées,
les arbitrages jour par jour depuis le 14/07/2026) vit maintenant dans un
document privé, hors de ce repo public. Ce fichier reste le point d'entrée
public sur le positionnement produit ; le document privé garde le détail
stratégique.
