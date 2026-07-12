# aivo

A personal AI "chief of staff" that lives in Discord. It's a single long-running
Node/TypeScript service: a Discord bot with an in-house LLM tool-calling agent loop,
first-class LLM cost control (model tiering, budget caps, an owner-approval gate for
expensive requests), and a YouTube subscriptions daily digest as its centerpiece
capability. A read-only web dashboard rides along as a second workspace in this repo,
served by the same backend pod.

Discord is the primary interface — there's no general-purpose HTTP API. The only HTTP
surface is `/health`, the dashboard API, and a one-time YouTube OAuth callback.

## Docs

- [`docs/concept.md`](docs/concept.md) — product concept: why this exists, the persona,
  the digest UX, cost-control philosophy.
- [`docs/technical-overview.md`](docs/technical-overview.md) — architecture and the
  technical decisions behind it.
- [`docs/data-model.md`](docs/data-model.md) — database schema and rationale.
- [`docs/deployment.md`](docs/deployment.md) — how it's deployed.
- [`docs/phase-3-web-dashboard-prd.md`](docs/phase-3-web-dashboard-prd.md) — the web
  dashboard's requirements.
- [`docs/roadmap.md`](docs/roadmap.md) — implementation status by slice. Each doc carries
  a status blockquote at the top — trust that over the prose beneath it, since the prose
  can lag the actual state of the code.
- [`AGENTS.md`](AGENTS.md) — repo map and conventions for coding agents working in this
  codebase.

## Stack

TypeScript on Node, pnpm workspaces (`backend/`, `frontend/`). Express + discord.js on the
backend, Postgres via Kysely, an OpenAI-SDK-compatible LLM provider. The frontend is a
Vite + React SPA. Biome for lint/format, Vitest for tests.

## Getting started

Requires Node (see `.nvmrc`), pnpm, and Docker (for backend tests). Copy `.env.example`
to `.env` and fill in a dev Discord bot token and the other secrets described there.

```
pnpm install
pnpm dev            # backend + frontend, both in watch mode
```

`docker-compose.yml` brings up Postgres alongside the service for a closer-to-prod local
run. See [`AGENTS.md`](AGENTS.md) for the full command list (typecheck, lint, test, build)
and the repo's internal conventions.
