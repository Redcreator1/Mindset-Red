# Mindset-Red · `mindset-ctx`

**Context-as-a-Service** pour projets open source & micro-SaaS.

Pour n'importe quel repo GitHub, `mindset-ctx` :

- **génère et maintient automatiquement** le contexte dont les agents IA ont besoin :
  `CLAUDE.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `CONTRIBUTING.md` et des
  templates de prompts (`.context/prompts.md`) ;
- **expose une API et un CLI** pour que les outils IA (Claude Code, Cursor, …)
  aient toujours le bon contexte, à jour ;
- **ajoute un memory layer** : l'historique du repo (commits aujourd'hui,
  PRs/issues/discussions demain) est indexé en JSONL et interrogeable, pour que
  chaque agent réutilise les décisions passées au lieu de les re-découvrir.

## Installation

```bash
npm install
npm run build
```

Node ≥ 20. Une seule dépendance runtime : le SDK officiel `@anthropic-ai/sdk`
(utilisé uniquement par le mode `--ai`, optionnel à l'exécution).

## Utilisation

```bash
# Générer / rafraîchir tout le contexte d'un repo
node dist/cli.js generate [path]

# Indexer l'historique git dans le memory layer (.context/memory.jsonl)
node dist/cli.js index [path] --limit 500

# … et y ajouter les PRs, issues et discussions via l'API GitHub
# (owner/repo déduit du remote origin, ou --repo owner/name ;
#  GITHUB_TOKEN pour les repos privés / plus de rate limit)
node dist/cli.js index [path] --github

# … et calculer les embeddings pour la recherche sémantique
# (Voyage AI, le partenaire embeddings d'Anthropic ; VOYAGE_API_KEY requis)
node dist/cli.js index [path] --embed

# Chercher dans la mémoire depuis le terminal
# (BM25 par défaut, --semantic pour les embeddings, --hybrid pour la fusion RRF)
node dist/cli.js search "payment retry" --repo-path [path] --hybrid

# Servir un ou plusieurs repos en HTTP pour les outils IA
node dist/cli.js serve [path ...] --port 4870 --api-key SECRET

# Mode hébergé multi-tenants : clés par client, scopes par repo, quotas
node dist/cli.js serve repoA repoB --tenants ctx.tenants.json

# Webhooks GitHub temps réel : à chaque push/PR/issue, la mémoire est
# ré-indexée et le contexte régénéré (signature HMAC vérifiée)
node dist/cli.js serve [path] --webhook-secret SECRET

# GitHub App : imprime le manifest pour une création en un clic
node dist/cli.js app manifest --base-url https://mon-hote.example.com

# Encaisser : génère une clé tenant + un lien de paiement Stripe
CTX_STRIPE_API_KEY=sk_live_... STRIPE_PRICE_MAP='{"price_123":"pro"}' \
  node dist/cli.js checkout --plan pro

# Facturation Stripe : les webhooks d'abonnement font basculer le plan
# d'un tenant (free/pro/team/enterprise → quotas), persisté sur disque
STRIPE_PRICE_MAP='{"price_123":"pro"}' \
  node dist/cli.js serve [path] --tenants ctx.tenants.json --stripe-secret whsec_...

# Génération enrichie par Claude : une synthèse narrative du projet est
# rédigée par Claude Opus 4.8 (thinking adaptatif) et injectée dans
# CLAUDE.md et docs/ARCHITECTURE.md (nécessite ANTHROPIC_API_KEY)
node dist/cli.js generate [path] --ai

# Voir l'analyse brute du repo (JSON)
node dist/cli.js analyze [path]

# Serveur MCP (Model Context Protocol) en stdio : Claude Code / Cursor
# consomment le contexte et la mémoire comme des outils natifs
node dist/cli.js mcp [path]
```

### MCP (Model Context Protocol)

`ctx mcp` expose trois outils via le standard MCP :

| Outil | Description |
| --- | --- |
| `get_context` | Lit un fichier de contexte (`claude`, `agents`, `architecture`, `contributing`, `prompts`) |
| `search_memory` | Recherche BM25 dans le memory layer (commits, PRs, issues) |
| `analyze_repo` | Analyse structurée fraîche du repo |

Enregistrement dans Claude Code :

```bash
claude mcp add mindset-ctx -- node /chemin/vers/dist/cli.js mcp /chemin/vers/repo
```

### API

| Route | Description |
| --- | --- |
| `GET /v1/health` | Liveness (jamais protégée) |
| `GET /v1/repos` | Repos enregistrés (filtrés par le scope du tenant) |
| `GET /v1/usage` | Consommation du tenant appelant (mode `--tenants`) |
| `GET /v1/repos/:repo/analysis` | Analyse structurée du repo (JSON) |
| `GET /v1/repos/:repo/context/claude` | `CLAUDE.md` (aussi : `agents`, `architecture`, `contributing`, `prompts`) |
| `GET /v1/dashboard` · `/v1/dashboard/data` | Dashboard web (HTML/JSON) : repos, tenants, plans, quotas, mémoire — scopé par tenant |
| `GET /v1/repos/:repo/memory/search?q=…&mode=…` | Recherche **BM25** (défaut), **sémantique** (`mode=semantic`) ou **hybride** (`mode=hybrid`, fusion RRF) |
| `POST /v1/repos/:repo/webhook` | Webhook GitHub (push/issues/PR) : HMAC `X-Hub-Signature-256` vérifiée, mémoire ré-indexée, contexte régénéré sur push |
| `GET /v1/app/manifest` | Manifest GitHub App (création en un clic) |
| `POST /v1/app/webhook` | Événements d'installation de l'App (HMAC vérifiée) |
| `GET /v1/checkout?plan=pro` | Crée un lien de paiement Stripe pour le tenant appelant (porte d'entrée paiement) |
| `POST /v1/stripe/webhook` | Événements d'abonnement Stripe (signature vérifiée) → change le plan du tenant |

Avec un seul repo servi, les raccourcis sans préfixe (`/v1/analysis`,
`/v1/context/claude`, `/v1/memory/search`) restent disponibles.

**Auth** : `--api-key` (ou env `CTX_API_KEY`) exige
`Authorization: Bearer <clé>` ou `x-api-key: <clé>` sur toutes les routes sauf
`/v1/health` (le webhook, lui, est authentifié par sa signature HMAC).

**Multi-tenants** (`--tenants ctx.tenants.json`) :

```json
{ "tenants": [
    { "key": "sk-alice", "name": "alice", "repos": ["frontend"], "plan": "pro" },
    { "key": "sk-admin", "name": "admin", "repos": "*", "plan": "enterprise" }
] }
```

Chaque clé est scopée à ses repos (403 hors scope), le **plan** décide du quota
journalier (`free` 200 · `pro` 5 000 · `team` 50 000 · `enterprise` illimité —
429 au-delà), et `/v1/usage` expose le métering. Les webhooks Stripe font
basculer le plan automatiquement et le changement est persisté dans le fichier.

### Édition manuelle préservée

Chaque fichier généré contient un marqueur `ctx:manual`. Tout ce que vous
écrivez **en dessous** est conservé lors des régénérations — le haut du fichier
reste toujours synchronisé avec la réalité du code.

## Repos privés — comment les devs l'utilisent

**Le mode self-hosted est fait pour les repos privés** : l'outil lit le clone
local (le tien), donc **ton code privé ne quitte jamais ta machine** — c'est un
argument de confidentialité, pas une limite.

```bash
# 1. Dans ton repo privé déjà cloné
node /chemin/dist/cli.js generate .     # génère le contexte
node /chemin/dist/cli.js index .        # indexe la mémoire

# 2. Branche-le dans Claude Code / Cursor via MCP (local, rien ne sort)
claude mcp add mindset-ctx -- node /chemin/dist/cli.js mcp /chemin/repo/prive
```

Pour la mémoire des PRs/issues d'un repo privé, `ctx index --github` utilise ton
`GITHUB_TOKEN` personnel (scope `repo`). En **mode hébergé**, la lecture des repos
privés passera par le token d'installation de la GitHub App (voir roadmap).

## Développement

```bash
npm test   # build + tests (node:test)
```

Ce repo est **dogfoodé** : ses propres `CLAUDE.md`, `AGENTS.md` et
`docs/ARCHITECTURE.md` sont générés par l'outil lui-même.

## Roadmap

- [x] v0.1 — analyse de repo, génération des 5 fichiers de contexte, memory layer (commits), API HTTP, CLI
- [x] v0.2 — ingestion GitHub API (PRs, issues, discussions) dans le memory layer
- [x] v0.2 — recherche classée par pertinence (BM25) derrière la même API
- [x] v0.2 — GitHub Actions : CI (Node 20/22) + régénération auto du contexte à chaque push sur `main`
- [x] v0.2 — serveur multi-repos + auth par clé API (graine du mode hébergé)
- [x] v0.3 — serveur **MCP** (Model Context Protocol) en stdio : le contexte devient des outils natifs pour Claude Code / Cursor
- [x] v0.3 — génération enrichie par l'**API Claude** (`generate --ai`, SDK officiel, Opus 4.8 + thinking adaptatif)
- [x] v0.4 — recherche **sémantique par embeddings** (Voyage AI, `index --embed` + `mode=semantic`, pluggable à côté de BM25)
- [x] v0.4 — **webhooks GitHub temps réel** : HMAC vérifiée, mémoire ré-indexée et contexte régénéré à chaque push
- [x] v0.4 — **multi-tenants** : clés par client, scopes par repo, quotas journaliers, métering `/v1/usage`
- [x] v0.5 — **GitHub App packagée** : manifest servi (`/v1/app/manifest`, création un clic) + webhook d'installation (`/v1/app/webhook`, HMAC vérifiée, cycle de vie classifié)
- [x] v0.5 — **facturation Stripe** : `POST /v1/stripe/webhook` (signature vérifiée sans SDK) fait basculer le plan d'un tenant ; plans → quotas, store de tenants persistant
- [x] v0.6 — **recherche hybride** BM25 + embeddings fusionnés par Reciprocal Rank Fusion (`mode=hybrid`, `ctx search --hybrid`)
- [x] v0.6 — **dashboard web** auto-porté (`/v1/dashboard`) : repos, tenants, plans, quotas et mémoire, scopé par tenant
- [x] v0.7 — **checkout Stripe** : `ctx checkout` / `GET /v1/checkout` créent un lien de paiement (clé tenant estampée dans les métadonnées) — la porte d'entrée « premier euro »
- [ ] Déploiement hébergé (URL publique) + provisioning self-service des tenants
- [ ] Token d'installation GitHub App (lecture des repos privés en mode hébergé)
- [ ] Support GitLab / Bitbucket ; SSO / RBAC (Team/Enterprise)
