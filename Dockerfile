# Two-stage Node 24 build for the aivo monorepo (backend + dashboard SPA).
# Source pattern: workbench/Dockerfile via homectl-reference templates/Dockerfile.
# The auth client is vendored (backend/src/auth/vendoredHomectlAuthClient.ts), so
# no github_token secret mount is needed yet — add it when swapping to the
# published @gagnatdev/homectl-auth-client package.
# -----------------------------------------------------------------------------
# Stage 1: Build frontend + backend
# -----------------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @aivo/frontend run build \
 && pnpm --filter @aivo/backend run build

# -----------------------------------------------------------------------------
# Stage 2: Runtime (no node_modules — server is bundled by tsup)
# -----------------------------------------------------------------------------
FROM node:24-alpine
WORKDIR /app

RUN adduser -D -g "" appuser
USER appuser

# Bundled server + SQL migrations (dist/migrations, copied by tsup onSuccess)
# + built dashboard SPA (web/, served by the backend at WEB_ROOT).
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/frontend/dist ./web

EXPOSE 8080
ENV PORT=8080 NODE_ENV=production WEB_ROOT=/app/web
ENTRYPOINT ["node", "dist/server.js"]
