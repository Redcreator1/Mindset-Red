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
- **15/07/2026** — Compte X (@MindsetAether) créé par l'utilisateur pour la
  communication produit, avec X Premium pour les Articles longs. Premier
  article rédigé (texte + deux visuels en SVG/PNG dans la palette du site)
  pour le lancement. Question ensuite posée : intégrer cet article sur le
  site via l'embed X officiel (`<blockquote class="twitter-tweet">` +
  `platform.x.com/widgets.js`) ? Réponse : non, pas pro — ça charge un
  script tiers (tracking X hors de notre contrôle), et la carte embarquée a
  le style X, pas la palette du site. Construit à la place un vrai blog
  natif (`src/blog.ts`, `GET /blog` et `/blog/:slug`) : contenu écrit dans
  le même design que `home.ts`/`pricing.ts`, visuels de couverture en SVG
  inline (pas d'image séparée à héberger, aucune dépendance externe, aucun
  script). Premier article publié : présentation de mindset-ctx, reprenant
  le texte et les visuels préparés pour X. Parité Node + Worker dès le
  départ. Le lien X reste utile pour partager/retweeter, mais le contenu
  lui-même vit sur notre domaine, indexable, sans dépendance à un service
  tiers.
- **15/07/2026** — Demande d'améliorer le site avant de reprendre le vrai
  travail. Proposé 4 pistes (Open Graph/Twitter Card, favicon, page 404
  stylée, robots.txt/sitemap) ; l'utilisateur a choisi uniquement les
  balises Open Graph/Twitter Card — les trois autres restent à faire si
  demandées plus tard. Construit : `ogMeta()` (home.ts, réutilisé par
  pricing.ts) génère les balises `og:title`/`og:description`/`og:image`/
  `og:url` + `twitter:card=summary_large_image` sur `/`, `/docs`,
  `/pricing`, `/blog` et `/blog/:slug` ; `og:image`/`og:url` omis (pas
  imprimés cassés) quand aucun `baseUrl` n'est configuré. Image de
  prévisualisation (1200×630, même identité visuelle que le logo/les
  visuels préparés pour X) servie par `GET /og-image.png`, encodée en
  base64 dans `src/og-image.ts` — décodée en `ArrayBuffer` plutôt qu'en
  `Uint8Array` à cause d'un vrai accroc TypeScript découvert en
  construisant ça : les déclarations ambiantes `BodyInit`/`Response` de
  `@types/node` et `@cloudflare/workers-types` ne se réconcilient pas
  proprement sur `ArrayBufferView`, `ArrayBuffer` est la seule forme que
  les deux acceptent sans ambiguïté. Signature de `shell()` (home.ts)
  changée d'une paire de paramètres positionnels vers un objet d'options
  pour porter `baseUrl`/`description`/`path` proprement. Parité Node +
  Worker, 3 nouveaux tests (bytes PNG valides 1200×630, balises présentes/
  absentes selon `baseUrl`, route `/og-image.png` sur les deux runtimes).
  Version 0.21.0.
- **15/07/2026** — Trois dernières pistes de polish du site attaquées d'un
  coup (favicon, page 404 stylée, robots.txt/sitemap) après validation
  utilisateur. Favicon : même logo crochets bleus que partout ailleurs,
  servi en SVG inline (`/favicon.svg`), `/favicon.ico` redirige dessus (les
  navigateurs le demandent par défaut même avec un `<link rel="icon">`).
  robots.txt/sitemap.xml : routes simples, sitemap liste les pages statiques
  + chaque article de blog (via `blogSlugs()` exporté de `blog.ts`, pas de
  duplication de la liste des posts).
  **Vrai bug trouvé en construisant la 404** : sur les deux runtimes, une
  route non reconnue tombait dans la porte d'authentification *avant*
  d'atteindre le point où elle aurait été reconnue comme "introuvable" — un
  visiteur non-authentifié tapant une mauvaise URL recevait "401
  unauthorized" au lieu de "404 not found", dès que l'auth tenant était
  configurée. Sur le Worker Cloudflare réellement déployé, l'auth tenant
  est *toujours* activée (`store.get(requestKey(req))` tourne sur chaque
  requête authentifiée), donc ce bug touchait 100% du trafic hébergé, pas
  un cas limite. Corrigé en sortant la vérification "page inconnue → 404
  stylée" *avant* la porte d'authentification pour tout chemin ne
  commençant pas par `/v1/` — les routes API gardent leur comportement
  auth-d'abord/JSON existant, inchangé. 11 nouveaux tests (favicon,
  robots.txt, sitemap, 404 stylée, et surtout le test de non-régression
  401→404 sur les deux runtimes). Version 0.22.0.
- **15/07/2026** — Demande explicite de passer sur "le lourd" après avoir
  écarté Slack/Linear/Notion (jugés "petits trucs" par l'utilisateur, pas
  bloqués sur l'argent mais reportés par choix). Confirmé via question :
  "le lourd" = **Rank**, la Phase 4 ("Moat technique") de la vision. Attaqué
  sous contrainte de temps réelle (limite de 5h Anthropic annoncée par
  l'utilisateur, session à reprendre après).
  Livré un **v0 honnête** plutôt qu'une promesse non tenue : `src/rank.ts`
  est un reranker linéaire (pas un modèle entraîné) au-dessus de la fusion
  RRF déjà en place — poids réglés à la main sur trois signaux (accord
  lexical+sémantique, correspondance titre/requête, fraîcheur), documentés
  comme point de départ explicitement destiné à être remplacé par des poids
  **appris** une fois qu'il existe un vrai jeu de données de pertinence
  (retours d'usage réels — clics, pouce haut/bas) et un budget
  d'entraînement. Ni l'un ni l'autre ne peut se construire dans cette
  session : la donnée de feedback n'existe pas encore (le produit vient
  tout juste d'avoir des vrais visiteurs), et l'entraînement demande le
  budget de "quelques milliers de $" déjà noté plus haut dans ce document
  — précisément ce qu'on a mis de côté aujourd'hui ("on travaille pas avec
  l'argent"). Branché directement dans `hybridSearch` (`hybrid.ts`) : la
  fusion RRF tourne maintenant sur le pool complet de candidats plutôt que
  d'être tronquée à `limit` avant reranking, pour que le reranker puisse
  faire remonter un résultat que RRF seul aurait laissé juste sous la
  coupure. 5 nouveaux tests unitaires sur `rank.ts` (correspondance titre,
  fraîcheur, bonus double-moteur, date invalide non bloquante, tri complet
  sans perte ni doublon) + suite existante (112 tests) toujours verte —
  117 au total. Version 0.23.0.
- **15/07/2026** — Suite immédiate : l'utilisateur propose d'aller plus loin
  que Rank v0 — entraîner un vrai modèle sur un T4 Colab gratuit (donc sans
  carte bancaire, compatible avec la contrainte du jour), et le brancher en
  prod. Corrigé une intuition erronée en passant : aucune restriction ne
  m'empêche d'écrire du vrai code d'entraînement/fine-tuning pour un
  utilisateur — les limites rencontrées sont d'infrastructure (pas de GPU
  ni d'accès à Colab depuis ce sandbox), pas une politique contre les
  "vrais modèles". Vérifié par `curl` : huggingface.co est bloqué par le
  proxy du sandbox (403 CONNECT tunnel failed) — même catégorie de blocage
  que JetBrains plus tôt cette session. Question posée à l'utilisateur sur
  comment gérer le déploiement, puisque Cloudflare Workers (notre prod) n'a
  pas de GPU et ne peut pas exécuter d'inférence neuronale sans passer par
  un service payant (Workers AI ou hébergement externe) — ce qui aurait
  reproduit la contrainte carte-bancaire plus loin dans le pipeline.
  **Réponse : "Runtime Node uniquement"** — le modèle entraîné tourne
  seulement sur `server.ts` (self-hosted, gratuit), le Worker Cloudflare
  garde Rank v0 heuristique. Écart de parité assumé et documenté, pas
  masqué.
  Livré `src/rank-ml.ts` : charge un cross-encoder MS MARCO fine-tuné
  **depuis un dossier local** (`CTX_RANK_ML_MODEL_DIR`), zéro appel réseau
  au runtime — évite complètement le blocage HuggingFace puisque
  l'inférence ne dépend que de fichiers déjà sur disque, exportés par
  l'utilisateur lui-même via `notebooks/train_rank_ml.py` (à exécuter dans
  Colab, qui a un accès réseau complet, pas ici). Repli automatique vers
  Rank v0 si le dossier est absent ou le chargement échoue — jamais de
  crash serveur. `@xenova/transformers` ajouté en `optionalDependencies`
  (pas `dependencies`) après avoir découvert que son installation échoue
  ici aussi : elle dépend de `sharp`, dont le binaire natif se télécharge
  depuis GitHub Releases — bloqué par le même proxy (403). En
  `optionalDependencies`, `npm install` se termine proprement (le paquet
  est silencieusement ignoré) au lieu d'échouer entièrement.
  Honnêteté sur la limite de ce qui a pu être vérifié : `mlRerank` (le
  blend de score) est testé unitairement (6 tests, reranker simulé,
  déterministe) — sa logique est réelle et vérifiée. Le câblage du pipeline
  `@xenova/transformers` dans `getMlReranker` est écrit contre l'API
  documentée de cette librairie mais n'a jamais pu tourner de bout en bout
  ici : aucun poids de modèle n'a jamais été disponible à charger. À
  vérifier par l'utilisateur après avoir exécuté le notebook.
  `npm audit` signale une vulnérabilité critique (`protobufjs`, via la
  chaîne `onnxruntime-web` d'`@xenova/transformers`, non corrigée dans
  aucune version 2.x publiée) — documentée et acceptée plutôt que cachée :
  le seul contenu jamais désérialisé est un modèle que l'opérateur a
  lui-même exporté, jamais une entrée réseau non fiable.
  6 nouveaux tests (`rank-ml.test.ts`) + suite existante (117 tests)
  toujours verte — 123 au total. Version 0.24.0.
- **15/07/2026** — L'utilisateur a réellement exécuté `notebooks/train_rank_ml.py`
  dans Colab (cellules 1 à 4 : installation, upload de `memory.jsonl` généré
  ici même via `ctx index .`, construction des 128 paires, fine-tuning —
  toutes passées sans erreur). La cellule 5 (export) a échoué en vrai :
  `git clone .../xenova/transformers.js` réussissait, mais
  `scripts/requirements.txt` et `scripts/convert.py` n'existaient plus
  ("No such file or directory", "No module named scripts.convert").
  Exactement la limite que j'avais signalée honnêtement dans le README du
  notebook ("à vérifier, non exécuté ici faute d'accès réseau à
  huggingface.co") — confirmée fausse par une exécution réelle plutôt que
  découverte par moi-même en amont.
  Diagnostiqué en lisant le vrai état actuel du projet (raw.githubusercontent.com
  est accessible depuis ce sandbox, contrairement à huggingface.co et à
  l'API GitHub pour des repos hors-scope) : le projet a été adopté par
  l'organisation GitHub `huggingface`, republié en npm sous
  `@huggingface/transformers` (v4.2.0) au lieu de l'ancien
  `@xenova/transformers` (legacy, abandonné), et son outil de conversion
  maison `scripts/convert.py` a été remplacé par l'exporteur ONNX standard
  `optimum-onnx` (`pip install "optimum-onnx[onnxruntime]"` puis
  `optimum-cli export onnx --task text-classification`).
  Corrigé avant merge : `src/rank-ml.ts` et `package.json` pointent
  maintenant vers `@huggingface/transformers` — la forme d'appel
  (`AutoTokenizer`/`AutoModelForSequenceClassification` avec l'option
  `text_pair` du tokenizer, pas le helper `pipeline()`) reste identique,
  reconfirmée contre les vrais `.d.ts` de la 4.2.0 via `npm pack` exactement
  comme pour le fix CI précédent. Le notebook exporte maintenant vers
  `rank_ml_model/onnx/model.onnx` (sous-dossier `onnx/` recréé à la main
  après l'export `optimum-cli`, pour correspondre à la convention
  `subfolder: "onnx"` que `@huggingface/transformers` attend par défaut).
  Aucun changement de test nécessaire (la correction ne touche que le
  chemin non exercé par les tests, par construction). Toujours 123/123.
  Bonus découvert en relançant `npm install` : `@huggingface/transformers`
  s'installe entièrement ici (contrairement à `@xenova/transformers`, dont
  le `sharp` transitif échouait sur le proxy) et `npm audit` passe de 4
  vulnérabilités (1 critique) à 0 — la vulnérabilité `protobufjs` documentée
  dans l'entrée précédente disparaît avec le changement de paquet.
- **16/07/2026** — Deuxième panne réelle trouvée en continuant l'exécution du
  notebook : la Cellule 5 corrigée échouait maintenant sur `mv: cannot stat
  'rank_ml_model/model.onnx'` — `optimum-cli export onnx` n'avait rien
  produit. Diagnostiqué pas à pas avec l'utilisateur (`!find / -iname
  "*fine_tuned*"` : aucun résultat nulle part) : le dossier `fine_tuned_model`
  que la Cellule 4 devait créer n'existait tout simplement pas, alors même
  que la barre de progression de l'entraînement s'affichait normalement.
  Vérifié contre le vrai code/doc actuel de `sentence-transformers` (comme
  pour `optimum`/`transformers.js` juste avant) plutôt que re-deviner :
  le paquet est passé en v5.x, qui remplace `CrossEncoder.fit(train_dataloader=
  ..., output_path=...)` (API pré-5.x utilisée dans la version précédente du
  notebook) par un `CrossEncoderTrainer` de style HF Trainer — celui-ci
  n'écrit **pas** automatiquement sur `output_path` ; il faut appeler
  explicitement `model.save_pretrained(...)` après `trainer.train()`. Le nom
  du modèle de base était aussi légèrement faux (`ms-marco-MiniLM-L-6-v2`
  avec tiret, alors que le vrai identifiant confirmé dans la doc actuelle est
  `ms-marco-MiniLM-L6-v2`, sans tiret).
  Cellules 3 et 4 réécrites pour utiliser l'API réelle et actuelle :
  `datasets.Dataset` à la place d'une liste de tuples, `CrossEncoderTrainer`
  + `BinaryCrossEntropyLoss` (adaptée à des labels 0/1 sur une seule sortie —
  exactement notre cas) à la place de `.fit()`, et un `model.save_pretrained
  ("fine_tuned_model")` explicite avant le print de confirmation.
  Deux corrections réelles en cascade sur ce notebook ce soir (paquet ONNX,
  puis API d'entraînement) — chacune trouvée en le faisant réellement tourner
  avec l'utilisateur et vérifiée contre la doc actuelle avant d'être proposée,
  pas depuis la mémoire. Aucun changement côté `src/` — uniquement
  `notebooks/train_rank_ml.py`, toujours 123/123 côté TypeScript.
- **17/07/2026** — Domaine acheté : pas `mindset-ctx.dev` finalement, mais
  **`mindsetctx.com`** (10,46 $/an, via Cloudflare Registrar directement —
  déjà géré par Cloudflare, zéro transfert de nameservers nécessaire).
  `CTX_BASE_URL` mis à jour dans `wrangler.toml`, `docs/DOMAIN-SETUP.md`
  et le commentaire d'en-tête de `src/home.ts` alignés sur le nom réel.
  Il reste une étape manuelle côté utilisateur (ajouter le Custom Domain
  dans le dashboard Cloudflare Workers — pas accessible depuis ce
  sandbox) avant que le nouveau domaine serve effectivement du trafic ;
  le sous-domaine `*.workers.dev` continue de fonctionner en parallèle
  entre-temps.
  En parallèle : premier vrai test de paiement Stripe en live confirmé
  techniquement fonctionnel (Checkout Session créée avec succès, compte
  `Mindset-Red` / `acct_1TdBzLKI826s6EYV`, clé nommée
  "Mindset-CTX-Github") — la session a expiré impayée (carte vide ce
  jour-là), donc la boucle complète (vrai paiement encaissé) reste à
  valider, mais l'infrastructure elle-même est confirmée opérationnelle.
- **17/07/2026** — `mindsetctx.com` confirmé en ligne : la PR #22 mergée a
  déclenché le déploiement, et le workflow lui-même a vérifié
  `https://mindsetctx.com/v1/health` en live (`"✅ Live at
  https://mindsetctx.com"` dans les logs GitHub Actions) — pas une
  supposition, une vérification réelle après un aller-retour où l'utilisateur
  a d'abord (deux fois) tapé l'URL dans la barre de recherche Google au lieu
  de la barre d'adresse, ce qui a fait planer un doute légitime ("arrête
  d'halluciner"). Résolu en lisant directement les logs du job de déploiement
  plutôt qu'en réaffirmant sans preuve.
  Décision suivante : plutôt que de désactiver la visibilité publique du
  sous-domaine `*.workers.dev` (ce qui casserait les liens déjà partagés
  avec une erreur d'authentification Cloudflare Access), le Worker redirige
  maintenant en 301 tout visiteur de `*.workers.dev` (production et preview)
  vers `CTX_BASE_URL` dès qu'il est configuré — les anciens liens continuent
  de fonctionner, juste redirigés vers le vrai domaine. Node-only concept
  côté Worker uniquement (`*.workers.dev` n'existe pas sur `server.ts`) :
  pas de parité à maintenir ici, c'est une spécificité Cloudflare. 4
  nouveaux tests (redirection prod + preview, pas de boucle sans
  CTX_BASE_URL, pas de redirection sur le domaine déjà canonique) — 116/116
  au total.
- **17/07/2026** — Demande explicite de retirer complètement le nom
  "workers" maintenant que le vrai domaine est payé et configuré : plutôt
  que de laisser `*.workers.dev` tourner en parallèle indéfiniment (ce que
  la redirection 301 de la session précédente permettait déjà, mais sans
  couper l'ancienne URL), ajouté `workers_dev = false` dans `wrangler.toml`
  — Cloudflare ne route plus du tout ce sous-domaine vers le Worker une
  fois le Custom Domain en place. `docs/DOMAIN-SETUP.md` mis à jour en
  conséquence. La redirection 301 dans `src/worker/index.ts` reste en
  place comme filet de sécurité (harmless si jamais réactivé), pas retirée.
  Au passage : la branche Rank ML (PR #21, encore non mergée) avait été
  créée avant la migration de domaine — un rebase sur `main` était
  nécessaire pour ne pas régresser `CTX_BASE_URL` vers l'ancienne URL
  `*.workers.dev` au prochain merge.
- **18/07/2026** — Après le premier vrai paiement encaissé, l'utilisateur a
  voulu utiliser le service comme un vrai client avant de partir à
  l'acquisition. En relisant `src/worker/index.ts` pour préparer ce test,
  découvert un vrai décalage entre la promesse marketing et ce que le Worker
  hébergé livre réellement : `/pricing`, `README.md` et la page d'accueil
  promettaient "recherche sémantique", "webhooks GitHub" et "mémoire
  d'équipe partagée" comme fonctionnalités du plan hébergé Pro/Team — mais
  le Worker n'a **aucune route** pour analyser un repo, indexer une mémoire
  ou servir MCP (`/v1/repos/*`, `/v1/*/memory/search`, `/v1/*/webhook`
  n'existent que sur `server.ts`, jamais sur `worker/index.ts` — Cloudflare
  Workers ne peut ni cloner ni lire un dépôt git). Confirmé aussi que
  `repoLimit`/`semantic` dans `billing.ts` sont des champs déclarés mais
  jamais lus nulle part ailleurs — de la donnée morte, jamais branchée à une
  vraie restriction. Un client payant Pro aujourd'hui reçoit un compte
  hébergé (clé, dashboard, quota suivi) — pas d'analyse de repo hébergée ;
  celle-ci tourne toujours en self-hosted (CLI), gratuite et illimitée sur
  tous les plans. Risque identifié avant l'acquisition de vrais clients,
  pas après : corrigé la promesse plutôt que le produit ce soir, sur
  demande explicite ("on corrige la promesse marketing pour être honnête").
  Réécrit `CARDS` (`pricing.ts`), la section "trust" de la page d'accueil
  (`home.ts`) et l'encart "repo privé" du README pour ne décrire que ce qui
  est mécaniquement vrai aujourd'hui : compte hébergé + dashboard + quota
  payants, analyse/recherche/MCP toujours self-hosted et gratuits. Corrigé
  au passage un deuxième décalage trouvé pendant la relecture : la carte
  Enterprise affichait "SSO (à venir)" alors que le SSO WorkOS est livré et
  fonctionne (v0.16) depuis plusieurs jours. Deux nouveaux tests
  (`pricing.test.ts`) verrouillent ces claims pour empêcher une régression
  silencieuse — 130 au total. La question ouverte (comment un client
  hébergé profite réellement de la CLI self-hosted — aujourd'hui aucune
  passerelle automatique entre la clé hébergée et une instance self-hosted)
  reste à trancher avant l'acquisition, volontairement pas résolue ce soir
  pour rester strictement dans le périmètre demandé ("corriger la
  promesse", pas construire la passerelle).
- **18/07/2026** — `npm audit` a signalé 3 vulnérabilités haute sévérité :
  `adm-zip` < 0.6.0 ("un ZIP conçu malicieusement déclenche une allocation
  de 4 Go de mémoire", GHSA-xcpc-8h2w-3j85), tirée en transitif par
  `onnxruntime-node` ← `@huggingface/transformers` (Rank ML). Ceci contredit
  l'entrée du 15-16/07 qui annonçait 0 vulnérabilité après le passage à ce
  paquet — l'avis `adm-zip` a manifestement été publié depuis. Vérifié
  qu'aucun correctif amont n'existe : la dernière version publiée
  (4.2.0, déjà celle installée) épingle exactement `onnxruntime-node@1.24.3`,
  la même version vulnérable ; le seul correctif que `npm audit fix --force`
  propose imposerait un retour à la 3.8.1, une API différente de celle sur
  laquelle `rank-ml.ts` est écrit, jamais testée. Le chemin de code
  vulnérable (traiter un ZIP piégé) n'est jamais atteint par notre propre
  logique — interne à l'empaquetage d'`onnxruntime-node`, jamais alimenté
  par une entrée utilisateur ici. Puisque Rank ML est en pause et que le
  paquet était déjà en `optionalDependencies` (donc non requis pour que le
  produit tourne), retiré entièrement de `package.json` plutôt que de
  forcer un downgrade risqué et non vérifié — `npm audit` repasse à 0.
  À rajouter (idéalement une version au-delà de 4.2.0, patchée) quand Rank
  ML redevient une priorité. Aucun test ne dépendait du paquet réellement
  installé (`getMlReranker` retourne `null` avant même d'essayer de
  l'importer dès que le dossier modèle est absent) — 130/130 toujours vert.
- **19/07/2026** — Avant l'acquisition de vrais clients, demande explicite de
  couvrir deux risques identifiés la veille : aucune base légale (CGV,
  confidentialité) et aucun canal de support. Deux décisions business
  tranchées par l'utilisateur : remboursement à 14 jours (satisfait ou
  remboursé) sur Pro/Team ; raison sociale et adresse volontairement
  laissées en `[À COMPLÉTER]` dans les documents plutôt que d'inventer une
  adresse — pas de fausse information dans un document légal.
  Livré `src/legal.ts` : `/terms` et `/privacy`, publiques, même traitement
  que `/docs`/`/blog` sur les deux runtimes. Contenu volontairement aligné
  sur la distinction hébergé/self-hosted corrigée hier (le service hébergé
  ne collecte jamais le code, ni les requêtes de recherche — seulement
  compte, clé, plan, compteur d'usage). Sous-traitants réels listés
  (Stripe, Cloudflare, WorkOS), pas une liste générique. `SUPPORT_EMAIL`
  extrait de `pricing.ts` (l'adresse mailto Enterprise existante) vers
  `home.ts`, réutilisé partout : pied de page du site, page de succès
  après paiement, dashboard. Ajouté au sitemap. Ces pages sont un point de
  départ solide, pas un avis juridique — à faire relire avant que le
  volume de clients ne justifie le risque. 8 nouveaux tests
  (`legal.test.ts` + routes sur les deux runtimes) — 134/134.
