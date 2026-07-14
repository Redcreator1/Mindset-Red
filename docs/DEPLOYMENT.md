# Déploiement dédié — Enterprise / VPC

> Ce que `/pricing` promet pour le plan Enterprise ("Instance dédiée / VPC") :
> une instance de `ctx serve` qui tourne entièrement **dans votre propre
> réseau**, aucune donnée ne transite par le service hébergé mindset-ctx.
> C'est le mode self-hosted, packagé pour tourner en production.

## Pourquoi c'est différent du self-hosted "gratuit"

Le self-hosted gratuit (voir `README.md`, section "Repos privés"), c'est vous
qui lancez `ctx serve` sur votre poste. Le déploiement Enterprise, c'est la
même image, mais :

- packagée en conteneur Docker versionné, pas un `npm run` local ;
- avec health-check, redémarrage automatique, montée en charge classique
  (n'importe quel orchestrateur : Docker Compose, Kubernetes, ECS…) ;
- avec un fichier de tenants (clés API, quotas par équipe) monté en volume,
  pas codé en dur ;
- et surtout : personne, pas même nous, n'a besoin d'y accéder pour que ça
  marche.

## Démarrage rapide (Docker Compose)

```yaml
# docker-compose.yml
services:
  mindset-ctx:
    build: .                       # ou l'image publiée une fois taguée/poussée
    ports:
      - "4870:4870"
    volumes:
      - ./repos:/repos              # vos repos (montés en lecture seule si possible)
      - ./ctx.tenants.json:/app/ctx.tenants.json:ro
    environment:
      CTX_TENANTS: /app/ctx.tenants.json
      CTX_WEBHOOK_SECRET: ${CTX_WEBHOOK_SECRET}
      # Optionnel — désactivé par défaut : mindset-ctx tourne sans jamais
      # appeler Stripe si ces variables ne sont pas définies.
      # CTX_STRIPE_SECRET: ${CTX_STRIPE_SECRET}
      # CTX_STRIPE_API_KEY: ${CTX_STRIPE_API_KEY}
    restart: unless-stopped
```

```bash
docker compose up -d --build
curl http://localhost:4870/v1/health
```

## Construire et lancer l'image directement

```bash
docker build -t mindset-ctx-enterprise .

docker run -d \
  -p 4870:4870 \
  -v "$(pwd)/repos:/repos" \
  -v "$(pwd)/ctx.tenants.json:/app/ctx.tenants.json:ro" \
  -e CTX_TENANTS=/app/ctx.tenants.json \
  -e CTX_WEBHOOK_SECRET="$CTX_WEBHOOK_SECRET" \
  --name mindset-ctx \
  mindset-ctx-enterprise
```

## Fichier de tenants (multi-équipes)

```json
{ "tenants": [
    { "key": "sk-team-frontend", "name": "frontend", "repos": ["web-app"], "plan": "team" },
    { "key": "sk-team-backend",  "name": "backend",  "repos": ["api", "worker"], "plan": "team" },
    { "key": "sk-admin",         "name": "admin",     "repos": "*", "plan": "enterprise", "admin": true }
  ] }
```

`admin: true` est nécessaire pour voir le dashboard consolidé de toutes les
équipes — un scope `"*"` seul ne suffit plus (voir l'audit de sécurité,
`docs/VISION.md`, décision du 11/07/2026).

## Variables d'environnement

| Variable | Rôle | Requis |
| --- | --- | --- |
| `CTX_PORT` | Port d'écoute (déf. 4870) | non |
| `CTX_API_KEY` | Clé unique partagée (mode simple, sans multi-tenants) | non si `CTX_TENANTS` est utilisé |
| `CTX_TENANTS` | Chemin vers le fichier de tenants | non (mode single-key sinon) |
| `CTX_WEBHOOK_SECRET` | Secret partagé pour les webhooks GitHub/GitLab | oui si vous voulez la resynchro temps réel |
| `CTX_STRIPE_SECRET` / `CTX_STRIPE_API_KEY` | Facturation Stripe | non — désactivé si absent, aucune dépendance externe forcée |
| `CTX_BASE_URL` | URL publique de cette instance (liens absolus) | recommandé en prod |

## Ce qui reste hors scope de ce guide

- **Pas de TLS intégré** : mettez un reverse proxy (nginx, Caddy, l'ingress de
  votre cluster) devant — `ctx serve` parle HTTP brut, volontairement, pour
  rester déployable n'importe où.
- **Pas de haute disponibilité multi-instance** : le stockage de mémoire
  (`.context/memory.jsonl`) et le fichier de tenants sont sur disque local ;
  plusieurs répliques nécessiteraient un stockage partagé (hors scope de
  cette v1 du guide).
- **SSO** : pas encore construit (voir `docs/VISION.md`, Phase 2).
