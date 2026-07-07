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

# Servir le contexte en HTTP pour les outils IA
node dist/cli.js serve [path] --port 4870

# Voir l'analyse brute du repo (JSON)
node dist/cli.js analyze [path]
```

### API

| Route | Description |
| --- | --- |
| `GET /v1/health` | Liveness |
| `GET /v1/analysis` | Analyse structurée du repo (JSON) |
| `GET /v1/context/claude` | `CLAUDE.md` (aussi : `agents`, `architecture`, `contributing`, `prompts`) |
| `GET /v1/memory/search?q=…&limit=…` | Recherche par mots-clés dans le memory layer |

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

- [x] v0 — analyse de repo, génération des 5 fichiers de contexte, memory layer (commits), API HTTP, CLI
- [ ] Ingestion GitHub API : PRs, issues, discussions dans le memory layer
- [ ] Recherche sémantique (embeddings) derrière la même API
- [ ] GitHub App / Action : régénération automatique à chaque push
- [ ] Mode hébergé multi-repos (micro-SaaS)
