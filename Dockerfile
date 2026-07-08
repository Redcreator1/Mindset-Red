# mindset-ctx — production image.
# Multi-stage: build with dev deps, ship a slim runtime.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Persistent state (tenants file with plans, memory index) lives on a volume
# mounted at /data. Overrides can be provided via env at startup.
ENV NODE_ENV=production PORT=4870 CTX_TENANTS=/data/tenants.json
EXPOSE 4870

# `serve` reads all its knobs from env: CTX_STRIPE_API_KEY, CTX_STRIPE_SECRET,
# STRIPE_PRICE_MAP, CTX_WEBHOOK_SECRET, CTX_BASE_URL, CTX_TENANTS.
CMD ["node", "dist/cli.js", "serve", "/data/repo", "--port", "4870", "--tenants", "/data/tenants.json"]
