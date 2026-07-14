# aivo — Architecture Improvements (Testability & AI Navigability)

> Status: **proposal — from a code review of the current `backend/` code.** Companion to
> [`technical-overview.md`](technical-overview.md), [`data-model.md`](data-model.md),
> and the [`roadmap.md`](roadmap.md). Nothing here is a rewrite: the review found the
> architecture fundamentally sound, and every suggestion below is an incremental change
> to an existing seam.

## What's already good (keep doing this)

The codebase (~3.4k production lines, ~1.3k test lines across 20 test files) already
follows the patterns the technical pass locked in, and several of them are exactly what
makes code testable and easy for AI tooling to navigate:

- **Dependency injection via `AgentDeps`** (`backend/src/agent/deps.ts`) — the agent
  core is free of discord.js and runs in tests against a real (Testcontainers) Postgres
  plus a scripted fake LLM (`backend/src/test/fakeLlm.ts`).
- **Repository pattern** (`backend/src/storage/*Repository.ts`) — one class per table,
  constructor-injected Kysely `Db`, every repository has a matching `.test.ts`.
- **`LlmProvider` interface** (`backend/src/llm/provider.ts`) — only
  `openaiProvider.ts` imports the OpenAI SDK; everything else is provider-agnostic.
- **Pure logic where it counts** — `deriveState()` in `backend/src/agent/budget.ts` is a
  pure threshold state machine; `resolveApproval()` in `backend/src/discord/router.ts`
  is deliberately Discord-thin so it unit-tests without an interaction object.
- **Normalization boundary** — `normalize()` converts a discord.js `Message` into a
  plain `IncomingMessage` before the core sees it.
- **Zod-validated env, fail-fast** (`backend/src/config/env.ts`), well-commented
  migrations, and unusually good docs in `docs/`.

The improvements below sharpen these seams rather than replace them.

---

## Part 1 — Testability

### 1.1 Make config injectable (stop importing the `env` singleton from core logic) — ✅ Implemented

> **Status: ✅ Implemented (2026-07-02).** `config/env.ts` no longer exports an
> eagerly-evaluated `env` singleton — it exports only `loadEnv()` + the Zod schema.
> Agent config is threaded through `AgentDeps.config` (`AgentConfig`:
> `agentMaxToolIterations`, `llmMaxOutputTokens`, `contextMessageLimit`,
> `memoryInjectLimit`); the Discord layer takes its own `DiscordConfig` (`botToken`,
> `guildId`, `homeChannelId`, `offlineAckThresholdMinutes`) passed into
> `createDiscordGateway()`, `shouldRespond()`, `processAndReply()`, and
> `catchUpOnMissedMessages()`. `bootstrap.ts` and `server.ts` are the only callers of
> `loadEnv()`. `logger.ts` reads `NODE_ENV`/`LOG_LEVEL` from `process.env` directly, as
> the one piece of infra that lives beneath the DI graph. The vitest `env:` block is now
> just `DATABASE_URL`. No behavior change.

**Problem.** `config/env.ts` validates `process.env` **at import time** and exports a
singleton (`export const env: Env = loadEnv()`). Nine files import it directly,
including core logic: `agent/agent.ts`, `discord/router.ts`, `discord/catchup.ts`,
`discord/client.ts`, `db/pool.ts`, `logger.ts`. Consequences:

- Every test run must fake a full set of env vars globally (see the `env:` block in
  `backend/vitest.config.ts`) just so modules can be *imported*.
- No test can vary config (e.g. a different `AGENT_MAX_TOOL_ITERATIONS`,
  `OFFLINE_ACK_THRESHOLD_MINUTES`, or guild id) without mutating shared module state.
- The agent core silently depends on more than `AgentDeps` declares — the deps
  interface *looks* like the full contract but isn't.

**Change.** Keep `loadEnv()` and the Zod schema exactly as they are; stop exporting the
eagerly-evaluated singleton. Thread config through the existing DI seam:

- Add the handful of agent-relevant values to `AgentDeps` (or an embedded
  `config` object): `agentMaxToolIterations`, `llmMaxOutputTokens`,
  `contextMessageLimit`, `memoryInjectLimit`. `bootstrap.ts` populates them from
  `loadEnv()` once, at the composition root.
- Give the Discord layer its own small config object (`guildId`, `homeChannelId`,
  `offlineAckThresholdMinutes`, `botToken`) passed into `createDiscordGateway()` and
  the router/catchup functions.
- `server.ts`/`bootstrap.ts` remain the only places that call `loadEnv()`.

**Payoff.** Per-test config without global fakes; the vitest `env:` block shrinks to
`DATABASE_URL` only; `AgentDeps` becomes the honest, complete contract of what the
agent needs. This is the single highest-leverage change in this document.

**Effort.** Medium (mechanical, ~9 files), no behavior change.

### 1.2 Inject a clock — ✅ Implemented

> **Status: ✅ Implemented (2026-07-02).** A one-method `Clock` (`agent/clock.ts`,
> `now(): Date`) is threaded through `AgentDeps.clock`. Production wires `systemClock`
> (`{ now: () => new Date() }`) at the composition root in `bootstrap.ts`; tests wire a
> settable `FakeClock` (`test/agentDeps.ts`, `set()`/`advance()`), which `makeAgentDeps`
> accepts as an optional third argument (defaults to `systemClock`). The direct
> process-side time reads in business logic now go through the clock: `monthStart()` in
> `agent/tools.ts` takes `deps.clock.now()`, the offline-ack age in `discord/router.ts`
> uses `deps.clock.now()`, and the boot-time stale-approval sweep in `bootstrap.ts` uses
> `deps.clock.now()`. Logging is left on real time. DB-side date bucketing
> (`date_trunc('month'|'day', now())` in `llmUsageRepository`) deliberately keeps using
> the **database** server's clock — one authoritative source for calendar spend windows —
> rather than the process clock; the budget month-rollover watermark rides on that. A new
> `tools.test.ts` case drives a `FakeClock` across a month boundary to show the
> month-to-date driver window is now deterministic. No behavior change.

**Problem.** Time is read ambiently all over: `monthStart()` in `agent/tools.ts`,
`Date.now()` in `discord/router.ts` (offline-ack age) and `bootstrap.ts` (approval TTL
sweep), month-rollover logic in `budget.ts`'s alert watermark, and date bucketing in
`llmUsageRepository`. The hardest-to-test behaviors in the system are exactly the
time-dependent ones: month rollover resetting the alert watermark, approval expiry,
stale-message acknowledgement — and the upcoming scheduler (digest hour, reminders)
will multiply this.

**Change.** Add a one-method clock to `AgentDeps`:

```ts
export interface Clock { now(): Date; }
```

Production wiring passes `{ now: () => new Date() }`; tests pass a settable fake.
Replace direct `new Date()` / `Date.now()` calls in business logic (not in logging)
with `deps.clock.now()`.

**Payoff.** Deterministic tests for rollover/expiry/staleness today, and the scheduler
slice (roadmap step 3.3–3.4) becomes testable by construction — you can "tick" a fake
clock past 07:00 instead of running node-cron in tests.

**Effort.** Small. Do it before the scheduler is built, not after.

### 1.3 Define the scheduler as an injectable port *before* building it — ✅ Implemented

> **Status: ✅ Implemented (2026-07-02, digest slice).** `scheduler/tick.ts` holds
> `runDueWork(deps, yt, deliverer, now)` — the stale-approval sweep (moved out of
> `bootstrap.ts`, now periodic) plus the digest due-check/dispatch — unit-tested against
> the test DB with a `FakeClock` (`tick.test.ts`). `scheduler/cron.ts` is the thin
> node-cron minutely wrapper, excluded from coverage like the other wiring. Delivery is
> a `DigestDeliverer` port implemented by `discord/digestDelivery.ts`.

**Problem (preemptive).** The scheduler is the next roadmap slice and is the classic
place where testability is lost: `node-cron` callbacks capturing module globals are
essentially untestable. There is already a smell pointing at the gap — the stale-
approval sweep in `bootstrap.ts` is a fire-and-forget one-shot at boot because there is
no periodic tick to hang it on.

**Change.** Split "when" from "what":

- `scheduler/tick.ts` — a pure-ish `runDueWork(deps, now: Date)` that queries for due
  work (digest watermark, due reminders, stale approvals) and dispatches it. Unit-test
  this against the test DB with a fake clock.
- `scheduler/cron.ts` — five lines of node-cron that call `runDueWork(deps,
  clock.now())` every minute. Excluded from coverage like the other thin wiring.

Move the approval sweep from `bootstrap.ts` into `runDueWork` so it becomes periodic
(fixing the "stale approvals linger until restart" issue) and covered by tests.

**Effort.** Free if done as part of the scheduler slice; expensive to retrofit.

### 1.4 Filter messages on the normalized shape, not the discord.js `Message` — ✅ Implemented

> **Status: ✅ Implemented (2026-07-02).** `shouldRespond()` (`discord/router.ts`) is now a
> pure, synchronous function of a normalized `MessageMeta`
> (`{ isBot, guildId, channelId, mentionsMe, referencedMessageAuthorIsMe }`) plus
> `DiscordConfig` — no discord.js `Message` and no network fetch inside the decision. A new
> `resolveMessageMeta(message)` in the same file is the one transport-coupled step: it reads
> the discord.js fields and performs the async referenced-message fetch (`isReplyToAivo`,
> still private) to build the `MessageMeta`. Both callers — the live gateway
> (`discord/client.ts` `onMessage`) and the offline catch-up (`discord/catchup.ts`
> `catchUpChannel`) — now do `shouldRespond(await resolveMessageMeta(message), cfg)`, so they
> keep applying identical rules while the policy stays mockless. `router.test.ts` gains a
> table-driven suite that drives the routing matrix (bot / wrong-guild / DM / home-channel /
> mention / reply-to-Aivo) with plain `MessageMeta` objects and zero discord.js mocks. No
> behavior change.

**Problem.** `shouldRespond()` and `isReplyToAivo()` (`discord/router.ts`) take the raw
discord.js `Message` and even perform a network fetch (`message.channel.messages
.fetch`) inside the decision. Testing them requires deep discord.js mocks, so the
routing *policy* (bot? right guild? home channel? mentioned? reply-to-aivo?) is welded
to the transport.

**Change.** Extend `IncomingMessage` (or add a `MessageMeta`) with the facts the policy
needs: `isBot`, `guildId`, `mentionsMe`, `referencedMessageAuthorIsMe`. The gateway
layer (`client.ts`) resolves those — including the async referenced-message fetch —
and the policy becomes a pure function:

```ts
export function shouldRespond(meta: MessageMeta, cfg: DiscordConfig): boolean
```

**Payoff.** The routing rules — which are subtle and shared between the live path and
catch-up — get exhaustive table-driven tests with zero mocks. The gateway keeps only
the mechanical "fetch the referenced message" part.

**Effort.** Small–medium.

### 1.5 One directory per tool, registry stays explicit — ✅ Implemented

> **Status: ✅ Implemented (2026-07-02).** The single `agent/tools.ts` is gone, replaced
> by an `agent/tools/` directory — one file per tool, each with its own colocated test:
> `index.ts` (`buildToolRegistry()`, `selectToolSchemas()`, `resolveTier()`, the
> `ToolContext`/`AgentTool` interfaces, and the shared `parse()`/`OWNER_ONLY` helpers),
> `memory.ts`, `budget.ts`, `models.ts`, `settings.ts`, plus `index.test.ts`,
> `memory.test.ts`, `budget.test.ts`, `models.test.ts`, `settings.test.ts`. Each tool's
> keyword gate now lives on the tool itself as an optional `gate?` field on `AgentTool`
> — the parallel `TOOL_GATES` record and the `ALWAYS_ON` set are both gone. (As of
> 2026-07-14 the gate is a `readonly string[]` of trigger keywords matched fuzzily by
> `gate.ts`, replacing the original `RegExp`, so a typo or garbled transcription still
> trips it.) `selectToolSchemas()` reads `t.gate` directly: a tool with no gate is always
> advertised,
> which is exactly how `memory` stays always-on. `agent.ts` imports from
> `./tools/index.js`; no other importers existed. Pure file moves plus one interface
> field — no behavior change (verified: registry order and gating are identical).

**Problem.** `agent/tools.ts` is 378 lines holding four tools (memory, budget, models,
settings), their Zod schemas, their JSON tool schemas, the keyword-gating regexes, and
misc helpers. Tests for all four live in one `tools.test.ts`. Every new capability
(YouTube digest, reminders — both imminent) lands in the same file; at 6–8 tools this
becomes the worst file in the repo for both humans and AI agents, and merge conflicts
concentrate there.

**Change.** Mechanical split, no design change:

```
agent/tools/
  index.ts        # buildToolRegistry(), selectToolSchemas(), ToolContext, AgentTool
  memory.ts       # memoryTool + its Zod schema (+ memory.test.ts)
  budget.ts       # budgetTool (+ budget.test.ts)
  models.ts       # modelsTool (+ models.test.ts)
  settings.ts     # settingsTool (+ settings.test.ts)
```

Keep each tool's keyword gate next to its definition (an optional `gate?: RegExp` field
on `AgentTool`) instead of the parallel `TOOL_GATES` record — today a tool and its gate
are 300 lines apart and drift silently.

**Payoff.** Per-tool tests, per-tool navigation ("the budget tool" is one file), and
adding a tool touches one new file plus one registry line.

**Effort.** Small; pure file moves plus one interface field.

### 1.6 Split `runAgent` policy from the tool loop — ✅ Implemented

> **Status: ✅ Implemented (2026-07-02).** `agent/agent.ts` is now a thin orchestrator
> (~80 lines): it calls `prepareTurn`, acts on the returned plan, and — when the turn is
> cleared — hands off to `runToolLoop`. The pre-flight policy moved into
> **`agent/prepareTurn.ts`** as `prepareTurn(deps, input): Promise<TurnPlan>`, a
> value-returning function that makes no LLM call and drives no loop. `TurnPlan` is a
> discriminated union of `PreparedTurn` (`{ model, messages, tools, maxTokens,
> overBudgetNote, ctx, registry }`), `GatedTurn` (`{ estimatedCostCents,
> approvalThresholdCents }` — the gate *decision*, no side effect), and `EarlyReply`
> (the no-model-configured short-circuit). `runAgent` owns the one side effect the gate
> needs — creating the pending-approval row and composing the confirmation reply — so
> `prepareTurn` stays pure-returning and its boundaries are asserted directly. The
> tool-calling loop plus `forceFinalAnswer` and the tool-dispatch/`executeToolCall`
> helpers moved into **`agent/toolLoop.ts`**; `runToolLoop` is the single entry point
> reused by both the fresh-turn and approval-resume paths. New **`prepareTurn.test.ts`**
> exercises the payoff directly — tier coercion, over-budget token capping, and the
> approval-gate fires/doesn't-fire boundary — without running a whole turn. Behavior is
> unchanged; the existing `agent.test.ts` end-to-end cases still pass through `runAgent`.
> The shared `"chat"` task type is defined in `toolLoop.ts` (metering) and mirrored in
> `prepareTurn.ts` (the gate), each with a comment pointing at the other.

**Problem.** `agent/agent.ts` (378 lines) interleaves four concerns: turn policy
(tier resolution → budget pre-check → context build → tool gating → approval gate),
the tool-calling loop, the stuck-loop/force-final-answer recovery, and approval-resume.
The loop is well-tested via the fake LLM, but the pre-flight policy can only be tested
by running whole turns; failure-path tests (approval gate fires / doesn't fire at the
boundary) need the entire machine.

**Change.** Extract the pre-flight into a pure-returning function, e.g.
`prepareTurn(deps, input): Promise<PreparedTurn | GatedTurn>` where `PreparedTurn`
carries `{ model, messages, tools, maxTokens, overBudgetNote }`. `runAgent` becomes:
prepare → maybe gate → `runToolLoop`. Move `forceFinalAnswer` + `runToolLoop` into
`agent/toolLoop.ts`.

**Payoff.** Approval-gate boundary conditions, tier coercion, and token capping become
cheap direct tests; the tool loop file is about the loop only.

**Effort.** Medium. Worth doing before the digest pipeline adds a second caller of the
loop.

### 1.7 Re-enable test parallelism before the suite gets slow

**Problem.** `vitest.config.ts` sets `fileParallelism: false` because all test files
share one database and reset with `TRUNCATE`. At 20 files this is fine; after the
YouTube/reminders/scheduler slices it will be 35+ files each paying full serial DB
round-trips, and the feedback loop will degrade exactly when the project needs it most.

**Change (pick one, in order of preference).**

1. **Schema-per-worker:** in `test/global-setup.ts`, create N schemas (or N databases)
   in the single Testcontainers instance — one per Vitest fork — and have `test/db.ts`
   pick by `VITEST_POOL_ID`. Migrations run once per schema. Then drop
   `fileParallelism: false`.
2. Transaction-rollback isolation (wrap each test in a rolled-back transaction) — less
   invasive but breaks for code that manages its own transactions later.

**Effort.** Small–medium, contained entirely in `src/test/`.

### 1.8 Add a linter/formatter and a real CI typecheck step — ✅ Implemented

> **Status: ✅ Implemented (2026-07-02).** Adopted **Biome** (single dev dependency,
> `@biomejs/biome`) as the combined formatter + linter — config in `backend/biome.json`.
> The formatter matches the existing house style (2-space indent, double quotes, always
> semicolons, trailing commas, 100-col width); the whole `src/` tree was normalized once
> so the baseline is clean. Linting runs Biome's recommended rules plus the nursery
> `noFloatingPromises` rule at **error** — directly the "unawaited async" guard called for
> here, and a good fit because the Discord layer's deliberate `void promise`
> fire-and-forget calls satisfy it explicitly. The one stylistic rule that conflicts with
> intentional patterns, `noNonNullAssertion`, is turned off. New backend scripts:
> `lint` (`biome check src` — format + lint, the CI gate), `lint:fix`
> (`biome check --write src`), and `format` (`biome format --write src`). CI
> (`.github/workflows/ci.yaml`) now runs two explicit static steps **before** the tests —
> `Backend typecheck` (`pnpm --filter @aivo/backend run typecheck`, i.e. `tsc --noEmit`,
> no longer hidden inside `pnpm build`) and `Backend lint & format check` (`… run lint`) —
> so a type or lint failure is reported distinctly from, and fails faster than, a test
> failure. No behavior change.

**Problem.** There is no ESLint/Biome/Prettier config anywhere in the repo, and CI's
only static check is the `tsc --noEmit` hidden inside `pnpm build`. Style is currently
consistent because one mind (plus one agent) wrote it; that won't survive contributors,
and lint rules are also how several classes of test-relevant bugs (floating promises,
unawaited async) get caught mechanically — notable here since the codebase deliberately
uses `void promise` fire-and-forget in the Discord layer.

**Change.** Adopt **Biome** (single dependency, fast, formats + lints) or ESLint +
`typescript-eslint` with `@typescript-eslint/no-floating-promises` on. Add
`pnpm --filter @aivo/backend run typecheck` and `lint` as explicit CI steps in
`.github/workflows/ci.yaml` so a lint/type failure is visibly distinct from a test
failure.

**Effort.** Small.

### 1.9 Introduce a tiny error taxonomy at the boundaries — ✅ Implemented

> **Status: ✅ Implemented (2026-07-02).** The three named error classes now live in
> `backend/src/llm/errors.ts`: `LlmProviderError { kind: 'auth' | 'rate_limit' |
> 'server' | 'network' }`, `ToolExecutionError { tool }`, and `ConfigError`.
> `toLlmProviderError()` — also in that file — is the single place that classifies an
> OpenAI SDK error into a `kind` (401/403 → `auth`, 429 → `rate_limit`, connection
> failure → `network`, everything else → `server`), and `openaiProvider.ts` wraps its
> one `chat.completions.create` call so every provider failure leaves the seam already
> tagged. In `agent.ts` the LLM catch block routes on `kind` via `llmErrorReply()` to
> pick the user-facing message (auth points at the config, rate-limit says "busy",
> server/network says "try again"); `executeToolCall` wraps a throwing tool in
> `ToolExecutionError` before feeding the failure back to the model; and `resolveModel`
> throws `ConfigError` when no tier has a model. Tests assert the taxonomy, not log
> strings: `llm/errors.test.ts` covers the SDK→`kind` mapping and `agent.test.ts`
> asserts the reply chosen per `kind` (the scripted fake LLM can now throw a
> `LlmProviderError`). The section below is preserved as the original proposal.

**Problem.** Every failure collapses to a generic string: `LLM_ERROR_FALLBACK` in the
agent, "Sorry — I ran into a problem handling that" in `client.ts`, "The X tool failed
to run" in `executeToolCall`. Operationally you can't distinguish (from behavior or
tests) an auth failure (permanent — alert the owner) from a rate limit (transient —
retryable) from a bug. Tests can't assert *why* a fallback happened.

**Change.** Not a framework — three named error classes thrown at the seams where the
information exists and is then lost:

- `LlmProviderError { kind: 'auth' | 'rate_limit' | 'server' | 'network' }` — mapped
  from the OpenAI SDK error in `openaiProvider.ts` (the only place that knows).
- `ToolExecutionError { tool: string }` — wrapping tool failures.
- Optionally `ConfigError` for the model-not-configured path.

The agent's catch blocks then switch on `kind` to pick the user-facing message (and,
later, retry policy), and tests assert taxonomy, not log strings.

**Effort.** Small.

### 1.10 Generate `db/schema.ts` instead of hand-maintaining it — ✅ Implemented

> **Status: ✅ Implemented (2026-07-02).** `backend/src/db/schema.ts` is now generated by
> `kysely-codegen` from the migrated database, with a do-not-edit header. `pnpm db:codegen`
> (`backend/scripts/codegen.ts`) starts the same throwaway Postgres the tests use
> (`PostgreSqlContainer` + `runMigrations`), introspects it, and rewrites the file. The
> shared generator config lives in `db/codegen.ts` so the script and the drift check can
> never disagree: it pins `numericParser: 'string'` (the money convention) and re-attaches
> the things codegen can't infer from plain SQL — the string-literal unions (`Channel`,
> `MessageRole`, `ModelTierRole`, `DegradationState`, `ApprovalStatus`) and the JSONB
> shapes (`number[]`, `string[]`, `Record<string, unknown>`) — via `overrides` +
> `customImports`. Those hand-authored unions moved to a separate, non-generated
> `db/schema.enums.ts` (the "separate file" this section anticipated), which the repositories
> now import. Drift is caught by `db/schema.codegen.test.ts`: it reuses the migrated
> Testcontainers Postgres from `src/test/global-setup.ts` (no extra container) and
> regenerates in `verify` mode, failing the suite — with "run `pnpm db:codegen`" — if a
> migration and the committed types disagree. Kysely's `Database` interface is now `DB`
> (`db/kysely.ts` updated); `kysely-codegen` is pinned as a dev dependency and the generated
> file is excluded from Biome. The section below is preserved as the original proposal.

**Problem.** The Kysely types in `backend/src/db/schema.ts` (192 lines) are written by
hand against 10 SQL migrations. Nothing verifies they agree; a drifted column type
produces confidently-wrong compile-time types — the worst kind of test blind spot.

**Change.** Run `kysely-codegen` against the migrated Testcontainers database (the
infra already exists in `test/global-setup.ts`) either as a CI check ("generated ==
committed") or as the source of the committed file. Hand-authored enums/aliases like
`DegradationState` can live in a separate non-generated file.

**Effort.** Small–medium; pays off forever as migrations 011+ land.

---

## Part 2 — AI navigability

These changes are cheap and specifically target how well AI coding agents (and new
humans) can orient, trust, and safely modify the codebase.

### 2.1 Add a `CLAUDE.md` / `AGENTS.md` at the repo root — ✅ Implemented

> **Status: ✅ Implemented (2026-07-02).** [`AGENTS.md`](../AGENTS.md) now lives at the
> repo root, covering all the points below tersely: what Aivo is (pointing at
> `docs/concept.md`), the `pnpm --filter @aivo/backend run …` commands (with the Docker +
> serial-tests caveat), a one-line-per-directory layout map, the non-obvious conventions
> (DI through `AgentDeps`; layering `discord/ → agent/ → (storage/, llm/)` with no
> discord.js in `agent/`; new table ⇒ repository + `.test.ts`; append-only migrations run
> at boot; money in fractional **cents**, prices per **Mtok**; `is_owner` enforced in tool
> execute functions), and a doc-status pointer (§2.2).

The single most effective navigability artifact is missing. It should contain, tersely:

- **What this is:** one paragraph, pointing at `docs/concept.md`.
- **Commands:** `pnpm --filter @aivo/backend run test | typecheck | dev | build`;
  note that tests need Docker (Testcontainers) and are currently serial.
- **Layout map:** one line per directory (`agent/` core + tools, `storage/`
  repositories, `discord/` gateway adapter, `llm/` provider interface, `db/` wiring,
  `migrations/` SQL applied at boot).
- **Conventions that aren't obvious from any single file:** DI through `AgentDeps`;
  new tables get a repository + a `.test.ts`; migrations are append-only and run at
  boot; money is fractional **cents**, prices are cents per **Mtok**; `is_owner` is
  enforced **in tool execute functions**, never via prompt text; discord.js types must
  not cross into `agent/`.
- **Doc-status pointer** (see 2.2).

### 2.2 Fix the stale-status trap in `docs/`

`roadmap.md` says "No code, no infra yet" and `data-model.md` says "Nothing here is
built yet" — while slices 1–2 (agent, memory, cost control, approval gate, catch-up)
are implemented and tested. For an AI agent that reads docs first (as instructed), this
is actively misleading: it invites re-scaffolding of things that exist.

**Change.** Update the status blockquotes to reflect reality, and add a short
"implementation status" table to `roadmap.md` (slice → done/in-progress/not-started →
key files). Cheap to maintain if it's one table in one file — and make updating it part
of the definition-of-done for each slice.

### 2.3 Keep files single-concern and under ~250 lines

The two 378-line files (`agent/agent.ts`, `agent/tools.ts`) are the only places the
codebase is hard to hold in one view; §1.5 and §1.6 fix both. Adopt the informal rule
that a file crossing ~250–300 lines or a second concern gets split. Small files with
predictable names (`agent/tools/budget.ts`) are dramatically easier for retrieval-based
agents to find and safely edit than large multi-concern ones.

### 2.4 Name the magic numbers, keep them near their owner

`CHEAP_MODELS_PCT = 80` (`budget.ts`), `TOOL_GATING_LOOKBACK = 4` (`prepareTurn.ts`),
`OVER_BUDGET_MAX_TOKENS = 256` (`prepareTurn.ts`) are fine as named constants — but they are
policy knobs, and two of them silently interact with the DB-stored
`alert_thresholds`. Give each a one-line comment stating its unit and its relationship
to neighbors (e.g. "must match an alert threshold or degradation happens un-alerted"),
or promote genuinely tunable ones into env with defaults. The existing comment style in
`env.ts` is the model to copy.

### 2.5 Record decisions as they're made (lightweight ADRs)

The `docs/` folder already does this well for the initial design ("Decisions (locked)"
sections). Continue the pattern for *implementation-time* decisions that would puzzle a
reader of the code: why in-house tool-calling instead of a framework, why keyword-gated
tool advertising, why tool/assistant rows are persisted but not replayed
(`context.ts`'s comment is a great inline example — some of these deserve promotion to
a `docs/decisions.md` list). One line each is enough; the win is that agents stop
"helpfully" reverting deliberate choices.

### 2.6 Document the dependency direction

The implicit layering is clean: `discord/ → agent/ → (storage/, llm/)`, with
`db/`+`config/` at the edges, and nothing importing back up. State it in CLAUDE.md
(one mermaid line) and, if desired, enforce it later with a lint rule
(`import/no-restricted-paths` or Biome's equivalent). This is the constraint most
likely to erode silently as the YouTube pipeline (which needs both discord delivery
and llm calls) gets built.

---

## Suggested order of attack

| # | Change | Effort | Payoff | When |
|---|--------|--------|--------|------|
| 1 | CLAUDE.md (§2.1) — ✅ done + doc status fix (§2.2) | XS | High | Now |
| 2 | Linter/formatter + CI steps (§1.8) — ✅ done | S | High | Now |
| 3 | Injectable config (§1.1) — ✅ done | M | High | Now, before more `env` imports accrete |
| 4 | Injectable clock (§1.2) — ✅ done | S | High | Before scheduler slice |
| 5 | Tools → one file per tool (§1.5) — ✅ done | S | Med–High | Before digest/reminder tools land |
| 6 | Scheduler as testable port (§1.3) — ✅ done | S* | High | As part of the scheduler slice |
| 7 | Pure `shouldRespond` (§1.4) — ✅ done | S–M | Med | Opportunistic |
| 8 | Error taxonomy (§1.9) — ✅ done | S | Med | Opportunistic |
| 9 | Split `runAgent` policy/loop (§1.6) — ✅ done | M | Med | Before a second loop caller exists |
| 10 | Schema codegen (§1.10) — ✅ done | S–M | Med | With the next migration batch |
| 11 | Parallel tests (§1.7) | S–M | Med (grows) | When suite passes ~30s |

\* free if designed in; expensive to retrofit.

None of these change runtime behavior; items 3–9 are refactors guarded by the existing
test suite, which is strong enough to make them low-risk.
