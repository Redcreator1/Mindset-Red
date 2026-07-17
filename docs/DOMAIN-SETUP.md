# Brancher mindsetctx.com — runbook

> Objectif : dès que le domaine est acheté, il ne reste plus qu'à suivre cette
> page — le code (vitrine `/`, doc `/docs`, tarifs `/pricing`) est déjà en
> place et déployé, voir `src/home.ts`.

## ⚠️ À savoir avant d'acheter

Le Worker Cloudflare qui sert mindset-ctx (`mindset-ctx.mindset2026.workers.dev`)
ne peut recevoir un domaine personnalisé ("Custom Domain") que si ce domaine
est **géré par Cloudflare** (nameservers pointés vers Cloudflare). Deux
chemins possibles :

- **Le plus simple** : acheter le domaine directement via
  [Cloudflare Registrar](https://dash.cloudflare.com/?to=/:account/domains/register) —
  zéro étape de transfert, le domaine est utilisable immédiatement. C'est ce
  qui a été fait pour `mindsetctx.com`.
- **Si acheté ailleurs** (Vercel, Namecheap…) : il faudra changer les
  nameservers du domaine pour pointer vers Cloudflare avant l'étape 2
  ci-dessous. Ça prend généralement quelques heures à se propager — pas
  instantané, à anticiper si vous achetez juste avant une annonce publique.

## Les étapes, une fois le domaine prêt côté Cloudflare

1. **Dashboard Cloudflare** → *Workers & Pages* → `mindset-ctx` → *Settings*
   → *Domains & Routes* → *Add* → *Custom Domain* → saisir `mindsetctx.com`
   (et `www.mindsetctx.com` si vous voulez les deux). Cloudflare crée le
   certificat TLS automatiquement.
2. **`wrangler.toml`** : mettre à jour `CTX_BASE_URL` pour qu'il pointe sur le
   vrai domaine plutôt que le `*.workers.dev` :
   ```toml
   [vars]
   CTX_BASE_URL = "https://mindsetctx.com"
   ```
   C'est cette variable qui construit les URLs absolues dans les redirections
   Stripe (`success_url`/`cancel_url`) et les liens du dashboard — sans ce
   changement, les emails/redirections continueraient de pointer vers l'ancien
   sous-domaine technique.
3. **Redéployer** : relancer le workflow GitHub Actions *"Deploy to Cloudflare
   Workers"* (ou laisser le prochain push sur `main` le faire automatiquement).
4. **Vérifier** : `curl https://mindsetctx.com/v1/health` doit répondre
   `{"ok": true, ...}`, et `https://mindsetctx.com/pricing` → cliquer
   "Passer Pro" doit rediriger vers une vraie session Stripe avec l'URL de
   succès en `mindsetctx.com` (pas l'ancien `*.workers.dev`).
5. **GitHub App** (si elle existe déjà) : son manifest (`buildAppManifest`)
   utilise aussi `CTX_BASE_URL` — vérifier que l'URL de callback enregistrée
   côté GitHub correspond au nouveau domaine, sinon les installs existantes
   redirigeront vers l'ancienne URL.

## Ce qui ne change pas

- Le sous-domaine technique `*.workers.dev` continue de fonctionner en
  parallèle par défaut (Cloudflare ne le désactive pas) — utile comme filet
  de sécurité pendant la transition.
- Aucune donnée (tenants, mémoire) ne bouge : c'est le même Worker, la même
  KV namespace, juste une nouvelle porte d'entrée DNS.
