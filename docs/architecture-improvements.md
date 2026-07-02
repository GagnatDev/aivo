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

### 1.2 Inject a clock

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

### 1.3 Define the scheduler as an injectable port *before* building it

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

### 1.4 Filter messages on the normalized shape, not the discord.js `Message`

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

### 1.5 One directory per tool, registry stays explicit

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

### 1.6 Split `runAgent` policy from the tool loop

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

### 1.8 Add a linter/formatter and a real CI typecheck step

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

### 1.9 Introduce a tiny error taxonomy at the boundaries

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

### 1.10 Generate `db/schema.ts` instead of hand-maintaining it

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

### 2.1 Add a `CLAUDE.md` / `AGENTS.md` at the repo root

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

`CHEAP_MODELS_PCT = 80` (`budget.ts`), `TOOL_GATING_LOOKBACK = 4` (`agent.ts`),
`OVER_BUDGET_MAX_TOKENS = 256` (`agent.ts`) are fine as named constants — but they are
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
| 1 | CLAUDE.md + doc status fix (§2.1, §2.2) | XS | High | Now |
| 2 | Linter/formatter + CI steps (§1.8) | S | High | Now |
| 3 | Injectable config (§1.1) — ✅ done | M | High | Now, before more `env` imports accrete |
| 4 | Injectable clock (§1.2) | S | High | Before scheduler slice |
| 5 | Tools → one file per tool (§1.5) | S | Med–High | Before digest/reminder tools land |
| 6 | Scheduler as testable port (§1.3) | S* | High | As part of the scheduler slice |
| 7 | Pure `shouldRespond` (§1.4) | S–M | Med | Opportunistic |
| 8 | Error taxonomy (§1.9) | S | Med | Opportunistic |
| 9 | Split `runAgent` policy/loop (§1.6) | M | Med | Before a second loop caller exists |
| 10 | Schema codegen (§1.10) | S–M | Med | With the next migration batch |
| 11 | Parallel tests (§1.7) | S–M | Med (grows) | When suite passes ~30s |

\* free if designed in; expensive to retrofit.

None of these change runtime behavior; items 3–9 are refactors guarded by the existing
test suite, which is strong enough to make them low-risk.
