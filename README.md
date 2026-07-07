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

Aucune dépendance runtime — juste Node ≥ 20.

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

# Servir un ou plusieurs repos en HTTP pour les outils IA
node dist/cli.js serve [path ...] --port 4870 --api-key SECRET

# Voir l'analyse brute du repo (JSON)
node dist/cli.js analyze [path]
```

### API

| Route | Description |
| --- | --- |
| `GET /v1/health` | Liveness (jamais protégée) |
| `GET /v1/repos` | Repos enregistrés |
| `GET /v1/repos/:repo/analysis` | Analyse structurée du repo (JSON) |
| `GET /v1/repos/:repo/context/claude` | `CLAUDE.md` (aussi : `agents`, `architecture`, `contributing`, `prompts`) |
| `GET /v1/repos/:repo/memory/search?q=…&limit=…` | Recherche **classée par pertinence (BM25)** dans le memory layer |

Avec un seul repo servi, les raccourcis sans préfixe (`/v1/analysis`,
`/v1/context/claude`, `/v1/memory/search`) restent disponibles.

**Auth** : `--api-key` (ou env `CTX_API_KEY`) exige
`Authorization: Bearer <clé>` ou `x-api-key: <clé>` sur toutes les routes sauf
`/v1/health`.

### Édition manuelle préservée

Chaque fichier généré contient un marqueur `ctx:manual`. Tout ce que vous
écrivez **en dessous** est conservé lors des régénérations — le haut du fichier
reste toujours synchronisé avec la réalité du code.

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
- [ ] Recherche sémantique par embeddings (pluggable derrière `searchMemory`)
- [ ] GitHub App : installation en un clic, webhooks PR/issue temps réel
- [ ] Mode hébergé multi-tenants complet (micro-SaaS : comptes, quotas, facturation)
