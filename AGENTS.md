# AGENTS.md

Aivo is a Discord-native personal AI agent: a backend that receives Discord messages,
runs an in-house LLM tool-calling loop with cost control and an owner-approval gate, and
persists everything to Postgres. A read-only web dashboard (phase 3) rides along as a
`frontend/` workspace served by the same backend pod. See [`docs/concept.md`](docs/concept.md)
for the why, [`docs/technical-overview.md`](docs/technical-overview.md) for the how, and
[`docs/phase-3-web-dashboard-prd.md`](docs/phase-3-web-dashboard-prd.md) for the dashboard.

## Commands

All commands run from the repo root (swap the filter to `@aivo/frontend` for the SPA):

```
pnpm dev                                    # backend :8080 + Vite frontend :3000
pnpm --filter @aivo/backend run dev        # watch-mode local run
pnpm --filter @aivo/backend run typecheck  # tsc --noEmit
pnpm --filter @aivo/backend run lint        # biome check (format + lint) — CI gate
pnpm --filter @aivo/backend run lint:fix    # biome check --write
pnpm --filter @aivo/backend run test        # vitest
pnpm --filter @aivo/backend run build       # typecheck + tsup bundle
```

Backend tests need **Docker** — they spin up Postgres via Testcontainers and are currently
**serial** (`fileParallelism: false`; the suite shares one database reset with `TRUNCATE`).
Without Docker, point `TEST_DATABASE_URL` at a disposable Postgres instead.

## Layout (`backend/src/`)

- `agent/` — agent core (`agent.ts` turn loop, `budget.ts`, `context.ts`, `clock.ts`) and `agent/tools/` (one file + colocated `.test.ts` per tool).
- `storage/` — repositories, one class per table, each with a `.test.ts`.
- `discord/` — discord.js gateway adapter, routing policy, catch-up, slash commands, digest delivery + feedback buttons, reminder delivery + snooze buttons.
- `digest/` — the YouTube daily digest pipeline (two-stage filter, due-check, proactivity lane, rejected-list taper, profile folding).
- `youtube/` — YouTube Data API + transcript ports (network impls behind interfaces; fakes in `test/`).
- `scheduler/` — `tick.ts` (testable `runDueWork`) + `cron.ts` (thin node-cron wiring).
- `llm/` — provider-agnostic `LlmProvider` interface + `openaiProvider.ts` + error taxonomy.
- `unforked/` — client for unforked's machine API (the family meal planner; see unforked docs/aivo-integration.md). Its API key is registered on the dashboard Settings page and stored in `unforked_connection` — never via chat or env.
- `db/` — Kysely wiring, pool, migration runner, and **generated** `schema.ts` (do not edit — run `pnpm --filter @aivo/backend db:codegen`; hand-authored enums live in `schema.enums.ts`).
- `config/` — Zod-validated env (`loadEnv()` + schema; no eager singleton).
- `routes/` — Express endpoints: health, YouTube OAuth, dashboard API (`/api/dashboard/*`).
- `auth/` — pluggable dashboard auth: `AUTH_MODE=dev` fixed principal vs `sidecar` (reads
  the `X-Homectl-*` identity headers the homectl-auth-proxy sidecar injects — the app does
  no OAuth work; see homectl-auth docs/sidecar/integration.md and k8s/deployment.yml).
  `middleware/resolveUser.ts` maps the auth subject to a `users` row.
- `test/` — Testcontainers setup, fakes, helpers.
- `backend/migrations/` — numbered SQL, append-only, applied at boot.

## Layout (`frontend/`)

Vite + React SPA (dashboard). `src/pages/` one file per route, `src/components/` shell,
`src/api/` fetch layer, `src/auth/` auth-agnostic seam (plain same-origin fetch; the
sidecar injects identity server-side) + `VITE_DISABLE_AUTH` dev bypass. No Discord or DB
imports; presentation only (PRD §5.1).

## Conventions

- **Dependency injection through `AgentDeps`** (`agent/deps.ts`) — the agent core never
  imports discord.js, `process.env`, or the OpenAI SDK. Config and the `Clock` are threaded
  in; tests wire a real DB + fake LLM + fake clock.
- **Layering: `discord/ → agent/ → (storage/, llm/)`**, with `db/`+`config/` at the edges.
  Nothing imports back up. **discord.js types must not cross into `agent/`.**
- New table ⇒ a repository **and** its `.test.ts`. Migrations are append-only, never edited.
  After a migration, regenerate `db/schema.ts` (`pnpm --filter @aivo/backend db:codegen`); a
  test fails if the committed types drift from the migrations.
- Money is fractional **cents**; prices are cents per **Mtok**.
- **`is_owner` is enforced in tool execute functions**, never via prompt text.
- Keep files single-concern and under ~250 lines.

## Docs status

Each `docs/` file carries a status blockquote — trust it over prose. See
[`docs/roadmap.md`](docs/roadmap.md) for the implementation-status table (slice → state →
key files) and [`docs/architecture-improvements.md`](docs/architecture-improvements.md) for
per-item status.
