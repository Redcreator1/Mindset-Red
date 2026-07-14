# mindset-ctx — Note de vision

> Enregistré le 14/07/2026 pour ne pas perdre le fil entre deux sessions. Version
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
  semaine (14–20 juillet 2026).
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

- **14/07/2026** — Domaine choisi : `mindset-ctx.dev`. Achat différé à la fin de la
  semaine (utilisateur), donc pas de travail de marque/branding tant que ce n'est pas
  acheté — focus code en attendant.
- **14/07/2026** — Première brique de la Phase 2 attaquée : **support GitLab**
  (ingestion mémoire PRs/issues), par choix de l'agent (Auto Mode) — ferme un vrai trou
  de roadmap, ne dépend pas d'un client Enterprise déjà signé, suit un pattern déjà
  éprouvé (`github.ts`). SSO/RBAC et déploiement dédié restent à prioriser ensuite.
- **14/07/2026** — Demande de construire simultanément SSO/RBAC, Bitbucket,
  déploiement VPC Enterprise, extension VS Code/JetBrains, intégrations
  Slack/Linear/Notion et programme de referral. Recadrage réaliste : ce n'est pas
  une journée de travail, c'en est plusieurs semaines. Trois items sont bloqués sans
  l'utilisateur (Slack/Linear/Notion nécessitent chacun la création d'une app
  développeur sur leur plateforme respective ; le programme de referral nécessite une
  décision business sur la structure de récompense). Livré à la place, dans le même
  esprit "réel et testé" que le reste du projet : **support Bitbucket** (ingestion
  mémoire, mêmes limites que GitLab côté webhook — pas de mécanisme de signature
  Bitbucket vérifié, donc pas implémenté plutôt que deviné), **doc Cursor** (le
  serveur MCP fonctionnait déjà avec Cursor, juste non documenté), et **déploiement
  Enterprise dédié** (`Dockerfile` + `docs/DEPLOYMENT.md`, ce que `/pricing`
  promettait sans l'avoir construit). SSO, extension IDE, intégrations tierces et
  referral restent à planifier — chacun mérite sa propre session dédiée plutôt
  qu'être bâclé ce soir.
- **14/07/2026** — Vitrine du domaine racine construite (`src/home.ts` : `/` et
  `/docs`), pour que brancher `mindset-ctx.dev` une fois acheté soit une pure
  opération DNS (voir `docs/DOMAIN-SETUP.md` pour le runbook exact — attention,
  le domaine doit être géré par Cloudflare pour qu'un Custom Domain fonctionne,
  à vérifier avant l'achat si acheté hors Cloudflare Registrar). Correction au
  passage d'un vrai bug : sur le serveur Node, `/` renvoyait toujours le JSON de
  `/v1/health` (les deux branches testaient `path === "/"`, celle du health
  check passait en premier) — la page pricing sur `/` n'était jamais atteinte.
- **14/07/2026** — Demande explicite de construire SSO/RBAC sans attendre un
  client Enterprise. Après investigation du modèle de données actuel : le
  concept de "rôle" (propriétaire/membre) n'a nulle part où s'accrocher tant
  qu'une clé API = un tenant = un compte isolé, ce qui est le modèle actuel.
  Ajouter un champ `role` cosmétique sans vraie structure d'équipe derrière
  aurait été une fonctionnalité coquille vide — exactement le genre de travail
  à moitié fini à éviter. Le vrai prérequis technique : un concept
  **d'organisation** avec plusieurs clés membres et une facturation partagée
  (multi-seat), *puis* des rôles dessus ont un sens (ex. : qui peut déclencher
  `/v1/checkout` pour changer le plan de toute l'équipe). C'est un chantier
  à part entière — prochaine session dédiée, pas une ligne ajoutée ce soir.
- **14/07/2026** — Le chantier Teams multi-sièges attaqué dans la foulée.
  Ajouté : `Organization` (id, plan, quota, repos partagés) dans
  `tenant-core.ts` ; `Tenant` gagne `orgId`/`role` (`owner`/`member`) ;
  `TenantStore`/`KvTenantStore` gèrent les organisations en plus des tenants
  (persistées ensemble) ; `UsageMeter`/`KvUsageMeter` poolent le quota au
  niveau de l'organisation quand `orgId` est posé — un siège de plus ne
  multiplie pas le quota, il le partage. Le signup self-service pour le plan
  **Team** crée automatiquement une organisation et met le premier compte en
  `role: "owner"` (Pro reste un tenant solo classique). `/v1/team/invite` et
  `/v1/team/remove` (owner uniquement) gèrent le roster ; `/v1/checkout` est
  refusé à un `member`. Câblé en parité complète sur `server.ts` (Node) **et**
  `worker/index.ts` (le Worker Cloudflare réellement déployé) — pas juste côté
  self-hosted. Refactor au passage : `WorkerTenant` (kv.ts) dupliquait `Tenant`
  de `tenant-core.ts` presque à l'identique ; fusionné vers le type partagé
  pour ne pas tripler la définition avec `Organization`.
  **Bug réel trouvé en écrivant les tests** : `tenantsEnabled` (server.ts)
  était calculé une seule fois à la construction du serveur
  (`store.all().length > 0`), donc un store démarrant vide (le cas normal
  pour le signup self-service ou une organisation qui grandit par invite)
  ne reconnaissait plus jamais aucun tenant créé après coup sur les routes
  authentifiées (`/v1/usage`, `/v1/checkout`, et maintenant `/v1/team/*`) —
  elles auraient toutes répondu 401/404 en boucle. N'affectait pas le Worker
  Cloudflare en production (lookup KV frais à chaque requête, pas de valeur
  figée), mais aurait cassé le mode self-hosted/Enterprise Docker dès qu'un
  client s'inscrivait après le démarrage. Corrigé : la condition reflète
  maintenant "le mode tenants a-t-il été activé" (présence de l'option), pas
  "le store contient-il des tenants là maintenant".
  9 nouveaux tests (Node + Worker) couvrent le cycle complet : création
  d'organisation au signup, webhook qui bascule le plan de l'org (pas du
  tenant), pooling du quota entre sièges, refus 403 pour un membre non-owner,
  et suppression d'un coéquipier (avec garde contre l'auto-suppression).
- **14/07/2026** — Trou trouvé puis corrigé : le README affirmait depuis la
  v0.10 que « l'installation de l'App GitHub provisionne automatiquement un
  tenant », mais cette logique (`/v1/app/manifest`, `/v1/app/webhook`,
  `/v1/app/installed`) n'a jamais existé que sur `server.ts` (Node
  self-hosted) — le Worker Cloudflare réellement déployé
  (`mindset-ctx.mindsetredcom.workers.dev`) n'avait jamais ces routes. Corrigé
  en portant les trois routes sur `worker/index.ts`, sur KV plutôt que sur le
  `TenantStore` en mémoire : `findByInstallationId` réajouté à `KvTenantStore`,
  vérification HMAC via `verifyGithubSignatureWeb` (Web Crypto, déjà écrit
  dans `worker/hmac.ts` mais pas encore branché), classification des
  événements réutilisée telle quelle depuis `githubapp.ts` (pur, portable —
  seul `mintAppJwt`/`getInstallationToken`, qui dépendent de `node:crypto`
  pour signer en RS256, restent CLI-only : le Worker ne lit jamais le contenu
  d'un repo, donc n'a pas besoin de token d'installation). `CTX_WEBHOOK_SECRET`
  ajouté au déploiement CI (`deploy-cloudflare.yml`) à côté des secrets Stripe
  existants. 3 nouveaux tests Worker mirroient exactement les tests Node
  existants (`billing.test.ts`) pour garantir que les deux runtimes restent
  synchronisés. Version 0.15.0.
- **14/07/2026** — Sous-domaine `workers.dev` du compte renommé par
  l'utilisateur (`mindsetredcom` → `mindset2026`, plus lisible en attendant
  l'achat du vrai domaine). `CTX_BASE_URL` mis à jour dans `wrangler.toml`
  (`https://mindset-ctx.mindset2026.workers.dev`) et redéployé — sinon les
  redirections Stripe et le manifest GitHub App auraient continué de pointer
  vers l'ancienne URL. Rappel : `mindset-ctx.dev` (achat prévu cette semaine)
  remplacera ce sous-domaine technique entièrement, voir
  `docs/DOMAIN-SETUP.md`.
- **14/07/2026** — SSO Entreprise construite (WorkOS AuthKit), demandée
  explicitement par l'utilisateur juste après le choix stratégique
  (`workOS!`). Design retenu : un cookie de session signé plutôt qu'un store
  de session côté serveur — signé par HMAC avec la clé API WorkOS (déjà un
  secret que seul le serveur détient), vérifiable sans lookup KV/disque à
  chaque requête, cohérent avec le reste de l'architecture stateless.
  `/v1/sso/login` redirige vers la connexion hébergée WorkOS ;
  `/v1/sso/callback` échange le code contre l'identité et auto-provisionne :
  premier employé d'une entreprise (`organization_id` WorkOS) → nouvelle
  organisation mindset-ctx + `role: "owner"` ; employés suivants de la même
  entreprise → rejoignent la même organisation en `role: "member"`, quota
  partagé (identifié via `Organization.ssoOrgId`, `Tenant.ssoUserId` —
  matching par id, pas par email, pour survivre à un changement d'adresse).
  Connexion personnelle sans entreprise WorkOS → simple tenant solo `free`,
  symétrique de tous les autres onboardings (Stripe, GitHub App). Câblé en
  parité complète Node (`server.ts`, `node:crypto`) **et** Worker Cloudflare
  (`worker/index.ts`, Web Crypto dans `worker/hmac.ts`) dès le départ — pas
  de dette à rattraper plus tard comme pour le GitHub App. 7 nouveaux tests
  (Node + Worker) : provisioning owner/member, dédoublonnage sur reconnexion,
  auth par cookie sur le dashboard, cookie trafiqué rejeté, logout, erreurs
  de configuration. Version 0.16.0. Reste à faire pour une vraie mise en
  production : le compte WorkOS lui-même (gratuit, à créer par
  l'utilisateur) et son Client ID/clé API à ajouter aux secrets GitHub
  (`WORKOS_CLIENT_ID`, `WORKOS_API_KEY`) pour que le déploiement les pousse
  vers Cloudflare comme les secrets Stripe.
- **14/07/2026** — SSO WorkOS testée en conditions réelles par l'utilisateur
  juste après le déploiement : un premier essai a buté sur `redirect_uri`
  refusé par WorkOS (l'URL de callback n'était pas encore déclarée dans les
  paramètres de l'application WorkOS — pas un bug côté code, une case à
  cocher manquante côté dashboard), puis sur une demande de carte bancaire en
  essayant de basculer en environnement Production (normal chez WorkOS,
  gratuit tant qu'aucune connexion SSO active n'existe — pas nécessaire ici,
  Staging suffit pour tester). Une fois l'URI de redirection ajoutée côté
  Staging : connexion réelle réussie, tenant auto-provisionné avec l'email
  comme nom, plan `free`, accès dashboard par cookie confirmé — validation
  de bout en bout, pas juste sur la théorie des tests automatisés.
- **14/07/2026** — Extension VS Code construite (`editors/vscode/`), demandée
  juste après la validation de la SSO. Scope volontairement réduit à VS Code
  seul pour cette session — JetBrains reporté explicitement : stack
  totalement différente (Kotlin/Gradle vs TypeScript), mérite sa propre
  session plutôt que d'être bâclée à la suite. Contrainte réelle découverte
  en concevant l'extension : mindset-ctx n'est pas publié sur npm, donc pas
  de `npx mindset-ctx` par défaut possible — la commande CLI à invoquer est
  demandée une fois à l'utilisateur puis mémorisée dans les réglages
  d'espace de travail (`mindsetCtx.cliCommand`). Palette de commandes
  (générer le contexte, indexer la mémoire, copier la commande MCP `claude
  mcp add`, ouvrir le dashboard hébergé) + indicateur de statut barre de
  statut. Logique pure (construction de la commande MCP, texte de statut)
  extraite dans des modules sans dépendance à `vscode`, testée par 6 tests
  `node:test` classiques ; la partie qui appelle réellement l'API `vscode`
  n'a **pas** de suite automatisée — honnêtement documenté plutôt que
  simulé : `@vscode/test-electron` a besoin de télécharger un vrai binaire
  VS Code et d'un serveur d'affichage (Xvfb), tous deux indisponibles dans ce
  sandbox distant. Vérifié à la place : compilation TypeScript propre contre
  `@types/vscode`, et `vsce package` produit un `.vsix` valide. Publication
  sur le VS Code Marketplace non faite — nécessite un compte éditeur
  Microsoft/Azure DevOps (gratuit), décision et création laissées à
  l'utilisateur.
- **14/07/2026** — Extension VS Code réellement publiée par l'utilisateur
  (Publisher `mindset-ctx` créé sur `marketplace.visualstudio.com`, compte
  Azure DevOps créé pour le jeton — au final l'upload direct du `.vsix` a
  suffi, pas besoin du token). Logo demandé et généré dans la foulée : crochets
  de contexte `[ • ]` dans la palette bleu/navy déjà utilisée sur les pages
  hébergées (`#2563eb` sur `#0b1220`), en SVG (source conservée dans
  `editors/vscode/icon.svg`) rasterisé en PNG via `cairosvg` (aucun outil de
  rendu SVG→PNG n'était installé dans ce sandbox — installé à la volée).
  Version extension 0.1.1. Petit aller-retour : la première tentative de
  republier a échoué ("la version 0.1.1 existe déjà") — pas un bug, preuve
  que l'upload précédent avait en fait déjà réussi ; la page publique
  affichait encore l'ancienne icône par simple cache navigateur.
- **14/07/2026** — Publication npm attaquée dans la foulée (`ont fonce`),
  identifiée comme prochain chantier non-bloqué après avoir listé l'état des
  lieux du roadmap. Corrige une vraie lacune trouvée en construisant
  l'extension VS Code : `mindset-ctx` n'a jamais été publié sur npm, donc
  aucun `npx mindset-ctx` possible, et `package.json` déclarait `"license":
  "MIT"` sans qu'un fichier `LICENSE` existe. Ajouté : `LICENSE` (MIT),
  `files`/`types`/`prepublishOnly` dans `package.json` (paquet propre —
  `dist/` sans les tests, README, LICENSE), et
  `.github/workflows/npm-publish.yml` qui publie automatiquement sur push
  vers `main` seulement si la version locale diffère de celle déjà publiée
  (`npm view mindset-ctx version`) — évite un échec bruyant à chaque commit
  qui n'est pas un bump de version. Nécessite un secret GitHub `NPM_TOKEN`
  (token "Automation" généré sur npmjs.com) que l'utilisateur doit créer et
  renseigner — je ne peux pas créer de compte npm à sa place.
- **15/07/2026** — Revue de sécurité complète demandée par l'utilisateur
  après la série de livraisons du jour (« lance une analyse de sécurité »).
  Vérifié sain : signatures Stripe/GitHub/GitLab (comparaison constante,
  anti-rejeu Stripe), cookie de session signé/expirant/anti-falsification,
  échappement HTML systématique (y compris noms de tenants issus d'emails
  SSO), page succès Stripe qui exige le paiement confirmé, `admin` jamais
  déduit, zéro secret réel dans le repo, paquet npm propre, secrets CI
  masqués. **Trois vraies failles trouvées et corrigées dans la foulée
  (v0.19.0)** : (1) le cookie de session était `SameSite=Lax` alors que
  `/v1/team/invite`, `/v1/team/remove` et `/v1/checkout` mutent en GET —
  un lien piégé cliqué par un owner connecté aurait exécuté l'action
  (CSRF) ; passé en `Strict`, le seul flux cross-site nécessaire (retour
  WorkOS → callback) utilisant désormais un cookie `state` séparé, Lax et
  jetable. (2) Le flux OAuth WorkOS ne passait pas de `state` — login-CSRF
  possible (forcer le navigateur d'une victime à finir le login avec le
  code de l'attaquant, la victime travaillant ensuite dans le tenant de
  l'attaquant sans le savoir) ; nonce généré au login, posé en cookie 10
  min, vérifié au callback en temps constant, 403 sinon — testé Node +
  Worker (state manquant, state falsifié, aucun tenant provisionné).
  (3) Extension VS Code : `mindsetCtx.cliCommand` était exécuté via shell
  (`exec`) et configurable par workspace — un repo malveillant pouvait
  planter une commande arbitraire dans son `.vscode/settings.json`,
  exécutée dès que la victime (ayant fait confiance au workspace) lançait
  une commande mindset-ctx ; corrigé en `execFile` (aucun shell) +
  `scope: "machine"` sur les deux réglages (un workspace ne peut plus les
  écrire), et le défaut devient `npx mindset-ctx` maintenant que le paquet
  est réellement sur npm — extension 0.1.2, à republier sur le
  Marketplace. Aucune des trois n'était critique (impacts limités par les
  clés secrètes et le Workspace Trust de VS Code), mais toutes étaient
  réelles — corrigées le soir même plutôt que consignées dans un backlog.
