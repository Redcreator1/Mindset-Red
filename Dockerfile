# Enterprise self-hosted / VPC deployment image — runs `ctx serve` inside
# your own network, no data ever reaches the hosted mindset-ctx. See
# docs/DEPLOYMENT.md for the full runbook (volumes, env vars, tenants file).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Repos to serve are bind-mounted at runtime (see docs/DEPLOYMENT.md); this
# is just a sane default mount point so `docker run -v` has somewhere to land.
RUN mkdir -p /repos
VOLUME ["/repos"]

EXPOSE 4870
ENV CTX_PORT=4870
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+(process.env.CTX_PORT||4870)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/cli.js", "serve"]
CMD ["/repos"]
