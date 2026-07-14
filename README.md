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

# … ou via l'API GitLab (issues + merge requests ; GITLAB_TOKEN pour privé)
node dist/cli.js index [path] --gitlab

# … ou via l'API Bitbucket Cloud (pull requests + issues ; BITBUCKET_TOKEN pour privé)
node dist/cli.js index [path] --bitbucket

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

Enregistrement dans **Cursor** — Cursor parle MCP nativement, aucun code
supplémentaire n'est nécessaire côté mindset-ctx. Ajoutez dans
`.cursor/mcp.json` (à la racine du projet, ou dans les réglages MCP globaux
de Cursor) :

```json
{
  "mcpServers": {
    "mindset-ctx": {
      "command": "node",
      "args": ["/chemin/vers/dist/cli.js", "mcp", "/chemin/vers/repo"]
    }
  }
}
```

Rechargez la fenêtre (ou redémarrez Cursor) — le serveur apparaît dans
*Settings → MCP*, et `get_context`/`search_memory`/`analyze_repo` deviennent
des outils que l'agent Cursor peut appeler directement pendant une session de
vibe coding. (Le nom exact du fichier de config peut évoluer selon la version
de Cursor — vérifiez leur doc officielle MCP si l'emplacement a changé.)

**Extension VS Code** (`editors/vscode/`, pas encore publiée sur le
Marketplace — mindset-ctx lui-même n'est pas encore sur npm, voir plus bas)
: palette de commandes ("mindset-ctx: Generate Context Files", "… Index
Memory", "… Copy MCP Server Command", "… Open Hosted Dashboard") + indicateur
dans la barre de statut (`CLAUDE.md` présent ou non). Se teste en local via
`F5` (Extension Development Host) ou en `.vsix` — voir
`editors/vscode/README.md` pour le détail, y compris la limite honnête :
la logique pure (construction de commande MCP, texte de statut) est testée
par `node:test`, mais le code qui appelle l'API `vscode` elle-même ne l'est
pas — `@vscode/test-electron` a besoin de télécharger un vrai binaire VS Code
et d'un serveur d'affichage, indisponibles dans ce sandbox.

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
| `POST /v1/repos/:repo/webhook` | Webhook GitHub **ou** GitLab (push/issues/PR) : signature `X-Hub-Signature-256` ou token `X-Gitlab-Token` vérifié selon le fournisseur détecté, mémoire ré-indexée, contexte régénéré sur push |
| `GET /v1/app/manifest` | Manifest GitHub App (création en un clic) |
| `POST /v1/app/webhook` | Événements d'installation de l'App (HMAC vérifiée) : provisionne/déprovisionne un tenant automatiquement |
| `GET /v1/app/installed?installation_id=…` | Redirection post-install : remet la clé API du tenant auto-provisionné (une seule fois) |
| `GET /v1/checkout?plan=pro` | Crée un lien de paiement Stripe pour le tenant appelant (porte d'entrée paiement) — refusé (403) à un membre d'équipe non-owner |
| `POST /v1/stripe/webhook` | Événements d'abonnement Stripe (signature vérifiée) → change le plan du tenant, ou de son **organisation** si c'est un siège d'équipe |
| `GET /v1/team/invite?name=…` | L'owner invite un coéquipier — clé mintée, quota et plan partagés (organisation), montrée une seule fois |
| `GET /v1/team/remove?key=…` | L'owner retire un coéquipier de l'organisation (pas soi-même) |
| `GET /v1/sso/login?org=…` | Redirige vers la connexion hébergée WorkOS AuthKit (SSO Entreprise) |
| `GET /v1/sso/callback` | Échange le code WorkOS contre l'identité, provisionne organisation/tenant, pose un cookie de session signé |
| `GET /v1/sso/logout` | Efface le cookie de session |

Avec un seul repo servi, les raccourcis sans préfixe (`/v1/analysis`,
`/v1/context/claude`, `/v1/memory/search`) restent disponibles.

**Auth** : `--api-key` (ou env `CTX_API_KEY`) exige
`Authorization: Bearer <clé>` ou `x-api-key: <clé>` sur toutes les routes sauf
`/v1/health` (le webhook, lui, est authentifié par sa signature HMAC).

**Multi-tenants** (`--tenants ctx.tenants.json`) :

```json
{ "tenants": [
    { "key": "sk-alice", "name": "alice", "repos": ["frontend"], "plan": "pro" },
    { "key": "sk-ops", "name": "ops", "repos": "*", "plan": "enterprise", "admin": true }
] }
```

Chaque clé est scopée à ses repos (403 hors scope), le **plan** décide du quota
journalier (`free` 200 · `pro` 5 000 · `team` 50 000 · `enterprise` illimité —
429 au-delà), et `/v1/usage` expose le métering. Les webhooks Stripe font
basculer le plan automatiquement et le changement est persisté dans le fichier.
`admin: true` doit être posé à la main (jamais déduit du scope `"*"`, que des
comptes clients légitimes utilisent aussi) — c'est ce qui donne la vue
dashboard de toute la plateforme.

**Organisations (Team multi-sièges)** — le plan Team est multi-utilisateurs
par nature : le signup self-service (`/v1/signup?plan=team`) crée
automatiquement une organisation et met le premier compte en `role: "owner"`.
Facturation et quota vivent sur l'organisation, pas sur chaque tenant :

```json
{ "tenants": [
    { "key": "sk-owner", "name": "owner", "repos": "*", "orgId": "org-1", "role": "owner" },
    { "key": "sk-bob",   "name": "bob",   "repos": "*", "orgId": "org-1", "role": "member" }
  ],
  "organizations": [
    { "id": "org-1", "name": "acme", "repos": "*", "plan": "team" }
] }
```

- Seul `role: "owner"` peut appeler `/v1/checkout` (changer le plan) ou
  `/v1/team/invite` / `/v1/team/remove` (gérer les coéquipiers) — un `member`
  reçoit 403.
- `/v1/usage` et le quota journalier sont **partagés** entre tous les sièges
  d'une organisation (un pool commun, pas un quota par personne).
- Le dashboard d'un owner montre le roster de son organisation ; un `admin`
  explicite voit toute la plateforme ; tout le monde d'autre ne voit que soi.

**SSO (WorkOS AuthKit)** — alternative à la clé API partagée pour les équipes
Entreprise : un employé se connecte via `GET /v1/sso/login` (redirige vers la
connexion hébergée WorkOS — email/mot de passe, Google, ou la connexion SSO
de son entreprise si configurée côté WorkOS), puis `/v1/sso/callback` :

- Premier employé d'une entreprise (identifiée par l'`organization_id` WorkOS)
  à se connecter → une organisation mindset-ctx est créée automatiquement et
  cette personne devient `role: "owner"`.
- Employés suivants de la **même** entreprise → rejoignent la même
  organisation en `role: "member"`, quota partagé, pas de doublon.
- Un cookie de session signé (`ctx_session`, HttpOnly, 7 jours) authentifie
  ensuite le dashboard exactement comme une clé `Authorization: Bearer`
  l'aurait fait — pas de nouveau store de session, la signature (HMAC avec la
  clé API WorkOS) suffit à le vérifier à la volée.
- Connexion personnelle sans entreprise WorkOS derrière → simple tenant solo,
  plan `free`, comme n'importe quel autre onboarding.

Configuration : créer une App sur [workos.com](https://workos.com) (gratuit
pour démarrer), déclarer `https://<votre-domaine>/v1/sso/callback` comme
redirect URI, puis exposer `WORKOS_CLIENT_ID` et `WORKOS_API_KEY` (`sk_test_…`
en bac à sable, `sk_live_…` en prod) — `--workos-client-id`/`--workos-api-key`
en self-hosted, secrets Cloudflare en hébergé (voir la section déploiement).

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
`GITHUB_TOKEN` personnel (scope `repo`) ; `ctx index --gitlab` fait pareil côté
GitLab avec `GITLAB_TOKEN`. Le webhook temps réel (`POST /v1/repos/:repo/webhook`)
détecte lui-même le fournisseur : signature `X-Hub-Signature-256` pour GitHub,
token partagé `X-Gitlab-Token` pour GitLab — même endpoint, même secret configuré
côté `--webhook-secret` / `CTX_WEBHOOK_SECRET`.

En **mode hébergé**, installer la GitHub App (`ctx app manifest`) provisionne
automatiquement un tenant scopé aux repos accordés — pas besoin de compte
préalable, symétrique du signup Stripe. La clé est remise sur la page de
redirection `/v1/app/installed?installation_id=…` juste après l'install.
Pour lire le contenu d'un repo privé ainsi accordé, mint un token
d'installation à la demande :

```bash
export GITHUB_APP_ID=123456
export GITHUB_APP_PRIVATE_KEY="$(cat mindset-ctx.private-key.pem)"
node dist/cli.js app token <installation-id>   # token 1h, scope = repos accordés
```

Le token imprimé s'utilise comme n'importe quel token GitHub pour cloner
(`git clone https://x-access-token:<token>@github.com/owner/repo.git`) ou
appeler l'API REST.

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
- [x] v0.8 — **page pricing publique** (`/pricing`), **signup self-service** (`/v1/signup?plan=…`) et **`ctx stripe bootstrap`** auto-créent les produits/prix dans Stripe.
- [x] v0.9 — **hébergé sur Cloudflare Workers** (`src/worker/`, `wrangler.toml`) : gratuit (100k req/j), edge, sans carte bancaire, état multi-tenant dans KV. `.github/workflows/deploy-cloudflare.yml` déploie sur chaque push vers `main`.
- [x] v0.9 — **`ctx stripe webhook <url>`** crée (ou réutilise, idempotent) le webhook Stripe par API — plus besoin d'accéder au Dashboard Stripe à la main.
- [x] v0.10 — **provisioning automatique par install GitHub App** (`/v1/app/webhook` crée/retire le tenant, `/v1/app/installed` remet la clé) + **`ctx app token <installation-id>`** mint un token d'installation (JWT App signé RS256 → échange) pour lire les repos privés accordés.
- [x] v0.11 — **support GitLab** : `ctx index --gitlab` (issues + merge requests via l'API v4) et webhook temps réel (`X-Gitlab-Token`, détection automatique du fournisseur sur le même endpoint que GitHub)
- [x] v0.12 — **support Bitbucket** : `ctx index --bitbucket` (pull requests + issues via l'API Cloud v2.0) — ingestion mémoire uniquement ; le webhook temps réel Bitbucket attend une vérification de son mécanisme de sécurité réel avant d'être câblé (Bitbucket n'a pas d'équivalent direct au HMAC GitHub / token GitLab)
- [x] v0.12 — **déploiement dédié Enterprise** : `Dockerfile` + `docs/DEPLOYMENT.md` (Docker Compose, fichier de tenants monté en volume, variables d'env documentées) — ce que `/pricing` promettait sans l'avoir construit
- [x] v0.12 — **doc Cursor** : `ctx mcp` fonctionnait déjà avec Cursor (MCP natif) mais n'était pas documenté — `.cursor/mcp.json` ajouté au README
- [x] v0.13 — **vitrine du domaine racine** (`/`, `src/home.ts`) séparée de `/pricing`, **doc index** (`/docs`) qui pointe vers le README/docs plutôt que de le dupliquer ; runbook de branchement du domaine (`docs/DOMAIN-SETUP.md`) — au moment de l'achat de `mindset-ctx.dev`, ce n'est plus qu'une opération DNS
- [x] v0.14 — **Teams multi-sièges** : signup Team crée une organisation (facturation + quota partagés, pas par siège) avec le premier compte en `role: "owner"` ; `/v1/team/invite` et `/v1/team/remove` gèrent le roster ; `/v1/checkout` refusé aux non-owners ; dashboard scopé (owner → son équipe, admin → toute la plateforme). C'est le prérequis RBAC identifié en v0.13 — désormais construit, sur Node **et** Cloudflare Workers.
- [x] v0.15 — **parité GitHub App sur le Worker Cloudflare réellement déployé** : `/v1/app/manifest`, `/v1/app/webhook` (HMAC vérifiée via Web Crypto) et `/v1/app/installed` n'existaient que sur `server.ts` (self-hosted) depuis la v0.10, malgré ce que le changelog laissait entendre — le Worker en prod n'avait jamais le provisioning auto par install. Corrigé : les trois routes tournent maintenant sur KV (`store.findByInstallationId`), `CTX_WEBHOOK_SECRET` poussé par `.github/workflows/deploy-cloudflare.yml`.
- [x] v0.16 — **SSO Entreprise via WorkOS AuthKit** : `/v1/sso/login` (redirige vers la connexion hébergée), `/v1/sso/callback` (échange le code, auto-provisionne organisation + tenant à partir de l'`organization_id`/`user.id` WorkOS, pose un cookie de session signé), `/v1/sso/logout`. Premier employé d'une entreprise → owner, suivants → members poolés, symétrique du signup Stripe et de l'install GitHub App. Le cookie de session est vérifié par HMAC (signé avec la clé API WorkOS) sans store de session dédié — cohérent avec l'architecture stateless existante. Parité Node **et** Cloudflare Workers dès le départ.
- [x] v0.17 — **extension VS Code** (`editors/vscode/`) : commandes de palette pour générer le contexte/indexer la mémoire, copier la commande MCP, ouvrir le dashboard hébergé ; indicateur de statut (`CLAUDE.md` présent ou non). Package séparé (son propre `package.json`/`tsconfig.json`, manifeste VS Code différent du reste du projet). Pas encore publiée sur le Marketplace (nécessite un compte éditeur Microsoft/Azure DevOps, gratuit — décision différée à l'utilisateur). 6 tests sur la logique pure ; la partie qui appelle l'API `vscode` se vérifie manuellement via `F5`, pas par une suite automatisée (`@vscode/test-electron` a besoin d'un vrai binaire VS Code + d'un display, indisponibles dans ce sandbox).
- [ ] Extension JetBrains (stack différente : Kotlin/Gradle plutôt que TypeScript — mérite sa propre session) ; intégrations Slack/Linear/Notion ; programme de referral — voir `docs/VISION.md` (bloqués sur un tooling différent, ou des identifiants que seul le fondateur peut créer)

## Déploiement en production (0 → premier euro)

Le mode hébergé tourne sur **Cloudflare Workers** (gratuit, sans carte bancaire,
100 000 requêtes/jour). Runbook zéro-configuration :

```bash
# 1. Créer les produits/prix Stripe (idempotent)
export CTX_STRIPE_API_KEY=sk_live_...
node dist/cli.js stripe bootstrap    # → imprime STRIPE_PRICE_MAP='{...}'

# 2. Déployer sur Cloudflare Workers (wrangler.toml livré, KV créé une fois)
npx wrangler kv namespace create CTX_KV     # une seule fois ; colle l'id dans wrangler.toml
npx wrangler secret put CTX_STRIPE_API_KEY
npx wrangler secret put STRIPE_PRICE_MAP
npx wrangler deploy

# 3. Créer le webhook Stripe SANS toucher au Dashboard (idempotent, réutilise
#    l'endpoint s'il existe déjà) :
node dist/cli.js stripe webhook https://<ton-worker>.workers.dev/v1/stripe/webhook
#    → imprime CTX_STRIPE_SECRET='whsec_...' à coller :
npx wrangler secret put CTX_STRIPE_SECRET
npx wrangler deploy

# 4. (optionnel) GitHub App — provisioning automatique par install, même sur
#    le Worker déployé (pas seulement en self-hosted) :
npx wrangler secret put CTX_WEBHOOK_SECRET   # même secret que celui déclaré dans l'App GitHub
npx wrangler deploy
#    Crée l'App depuis le manifest : POST https://<ton-worker>.workers.dev/v1/app/manifest
#    vers https://github.com/settings/apps/new

# 5. (optionnel) SSO Entreprise via WorkOS — créer une App sur workos.com,
#    déclarer https://<ton-worker>.workers.dev/v1/sso/callback comme redirect URI :
npx wrangler secret put WORKOS_CLIENT_ID
npx wrangler secret put WORKOS_API_KEY
npx wrangler deploy

# 6. C'est tout. /pricing est publique, /v1/signup prend l'argent, la clé
#    API est activée automatiquement par le webhook (Stripe, GitHub App ou SSO).
#    Zéro humain dans la boucle.
```

**Via GitHub Actions (recommandé, zéro terminal)** : configure les secrets
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CTX_STRIPE_API_KEY`,
`STRIPE_PRICE_MAP` sur le repo, lance le workflow **Deploy to Cloudflare
Workers**, puis le workflow **Stripe — bootstrap webhook** (crée le webhook
via l'API Stripe avec la clé déjà configurée — aucun accès au Dashboard
requis) et colle le `CTX_STRIPE_SECRET` imprimé dans les secrets GitHub avant
de relancer le déploiement.

> **Repo privé, code sensible ?** Aucun code source ne quitte votre machine
> par défaut : `ctx generate` / `index` / `serve` tournent en local. Le mode
> hébergé (Worker) sert uniquement l'analyse structurée + les fichiers de
> contexte déjà générés — jamais le code lui-même.
