# AGENTS.md

Aivo is a Discord-native personal AI agent: a backend that receives Discord messages,
runs an in-house LLM tool-calling loop with cost control and an owner-approval gate, and
persists everything to Postgres. See [`docs/concept.md`](docs/concept.md) for the why, and
[`docs/technical-overview.md`](docs/technical-overview.md) for the how.

## Commands

All backend commands run from the repo root:

```
pnpm --filter @aivo/backend run dev        # watch-mode local run
pnpm --filter @aivo/backend run typecheck  # tsc --noEmit
pnpm --filter @aivo/backend run lint        # biome check (format + lint) — CI gate
pnpm --filter @aivo/backend run lint:fix    # biome check --write
pnpm --filter @aivo/backend run test        # vitest
pnpm --filter @aivo/backend run build       # typecheck + tsup bundle
```

Tests need **Docker** — they spin up Postgres via Testcontainers and are currently
**serial** (`fileParallelism: false`; the suite shares one database reset with `TRUNCATE`).

## Layout (`backend/src/`)

- `agent/` — agent core (`agent.ts` turn loop, `budget.ts`, `context.ts`, `clock.ts`) and `agent/tools/` (one file + colocated `.test.ts` per tool).
- `storage/` — repositories, one class per table, each with a `.test.ts`.
- `discord/` — discord.js gateway adapter, routing policy, catch-up, slash commands.
- `llm/` — provider-agnostic `LlmProvider` interface + `openaiProvider.ts` + error taxonomy.
- `db/` — Kysely wiring, pool, migration runner, and **generated** `schema.ts` (do not edit — run `pnpm --filter @aivo/backend db:codegen`; hand-authored enums live in `schema.enums.ts`).
- `config/` — Zod-validated env (`loadEnv()` + schema; no eager singleton).
- `routes/` — Express health endpoints. `test/` — Testcontainers setup, fakes, helpers.
- `backend/migrations/` — numbered SQL, append-only, applied at boot.

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
