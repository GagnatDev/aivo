# Two-stage Node 24 build for the backend-only aivo monorepo.
# Source pattern: workbench/Dockerfile, trimmed to a single `backend` workspace
# (no frontend stage, no SPA web/ copy). The v1 backend has no private @gagnatdev/*
# deps, so no github_token secret mount is needed.
# -----------------------------------------------------------------------------
# Stage 1: Build the backend
# -----------------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @aivo/backend run build

# -----------------------------------------------------------------------------
# Stage 2: Runtime (no node_modules — server is bundled by tsup)
# -----------------------------------------------------------------------------
FROM node:24-alpine
WORKDIR /app

RUN adduser -D -g "" appuser
USER appuser

# Bundled server + SQL migrations (dist/migrations, copied by tsup onSuccess).
COPY --from=build /app/backend/dist ./dist

EXPOSE 8080
ENV PORT=8080 NODE_ENV=production
ENTRYPOINT ["node", "dist/server.js"]
