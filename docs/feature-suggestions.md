# aivo — Feature Suggestions

> Status: **proposal — ideas to react to, not commitments.** Companion to
> [`concept.md`](concept.md) and the [`roadmap.md`](roadmap.md). The locked roadmap
> (YouTube digest → reminders → mail triage → household/dashboard) stays the spine;
> this document collects features that either **polish what's already built**, **fall
> out of the roadmap almost for free**, or are **worth considering after v1**. Each
> entry notes its cost-control implication, since that's a first-class concern.

## How to read the groupings

- **A. Polish for what exists today** — small, high-value additions to the shipped
  agent/memory/budget slices; mostly no new tables.
- **B. Falls out of the roadmap** — things the concept already promises or the schema
  already reserves, called out so they don't get lost.
- **C. New ideas (post-v1 candidates)** — genuinely new, kept aligned with the
  "one assistant, bounded proactivity, cost-controlled" identity.

---

## A. Polish for what exists today

### A1. Discord-native slash commands with autocomplete

The `!command` prefix (`!help`, `!budget`, `!models`, …) works but is invisible —
users must remember it. Registering the same commands as Discord **slash commands**
gives discovery, argument autocomplete, and typed options in the client UI for free.
Keep the `!` prefix as an alias; both already route to the same `runCommand` core.
*Surface:* `discord/commands.ts`, one-time command registration call at startup.
*Cost:* zero LLM tokens — these paths deliberately bypass the model.

### A2. Natural-language money in the budget tool

The budget tool takes integer cents (`monthly_ceiling_cents: 1500`). The model mostly
translates, but "set my budget to 15 bucks" occasionally produces unit mistakes — and a
wrong budget is a trust-killer for the *cost-control* feature. Accept a string amount
(`"$15"`, `"15 kr"`, `"1500 cents"`) parsed deterministically in the tool, echo the
interpretation back ("Monthly ceiling set to **$15.00**"), and have the agent confirm
before applying changes ≥10× the current value.
*Surface:* `agent/tools.ts` (budget tool schema + parse helper).
*Cost:* none; slightly fewer failed round-trips.

### A3. Spend report as a formatted embed + "estimate before you ask"

Two small upgrades to the existing `budget report`:

1. Render the report as a Discord **embed** (progress bar toward ceiling, top drivers
   table) instead of a JSON-ish sentence — this is the single most-viewed proactive
   artifact once alerts fire.
2. A `!estimate <question>` command (or "what would it cost to…?") that runs the
   existing `estimateTurnCost` path **without** calling the model, so the user can
   price a big ask first. The machinery already exists for the approval gate.

*Surface:* `discord/commands.ts`, reuse `agent/agent.ts#estimateTurnCost`.
*Cost:* negative — it prevents expensive calls.

### A4. Memory pinning, editing, and browsing from chat

The schema already supports `pinned` (used for context injection priority) and
soft-delete, but there's no user-facing way to pin, edit, or page through memories.
Add `pin`/`unpin`/`edit` actions to the memory tool and a compact paged `!memory list`
(id, category, pinned-star, first line). "Edit" closes the loop of *inspectable*
memory: today a wrong memory must be forgotten and re-taught.
*Surface:* `agent/tools.ts` (memory tool), `storage/memoryRepository.ts` (update, one
new method).
*Cost:* none.

### A5. Reaction-based lightweight feedback on replies

Let 👍/👎 reactions on any aivo reply write a `feedback`-style memory ("user disliked
the long answer about X"). This is the same feedback muscle the YouTube digest needs
(buttons + freeform), exercised early on the conversational surface — and it seeds the
persona tuning ("be more casual") with real signal.
*Surface:* `discord/client.ts` (add `MessageReactionAdd` intent + handler), reuse
memory writes.
*Cost:* none per reaction; optional periodic distillation is one cheap-tier call.

### A6. "Why did you say that?" — turn introspection

Because every turn already persists intermediate tool calls and tool results
(`messages` rows with role `assistant`/`tool`), a `!trace` command can show the last
turn's tool calls, models used, token counts, and cost — the chat-native equivalent of
an trace viewer. Great for trust, great for debugging tool-gating misses.
*Surface:* `discord/commands.ts` + one query over `messages`/`llm_usage`.
*Cost:* none.

---

## B. Falls out of the roadmap (don't lose these)

### B1. End-of-day usage report with auto-taper *(concept promise, not yet built)*

[`concept.md`](concept.md) promises a proactive end-of-day spend report that
auto-tapers to weekly once the user stops reacting to it. All the data (llm_usage
ledger, budget config) and soon the delivery mechanism (scheduler) exist. Implement it
as the scheduler's second consumer after the digest; store the taper state in
`settings.proactivity`.
*Cost:* the report itself should be template-rendered, not LLM-written — zero tokens.

### B2. Proactivity toggles surfaced in settings *(schema exists, unused)*

`settings.proactivity` (jsonb) is reserved for per-lane toggles (digest, reminders,
usage reports, later mail alerts) but nothing reads or writes it. When the scheduler
lands, expose it: "mute the digest for a week", "stop daily reports". Bounded
proactivity is a core identity trait — the *off switches* are part of the feature.
*Surface:* settings tool + scheduler checks.

### B3. Digest archive & feedback history *(one query away once digests exist)*

The digest schema (`digests`, `digest_items`, `feedback`) retains everything;
plan for "what was in Tuesday's digest?" and "what have I thumbs-downed this month?"
as chat queries from day one. Retroactively useful for trust ("did it really skip X?")
and for tuning the interest profile.
*Cost:* retrieval only; summarizing an old digest reuses stored TL;DWs.

### B4. Digest → watch-later loop

A "save for later" button on each digest entry (alongside keep/drop) that files the
video into a watch-later list, with "what's on my watch list?" and a gentle weekly
nudge including its age ("3 videos, oldest 12 days"). Cheap, sticky, and it feeds the
interest profile a *positive* signal that's stronger than a mere keep.
*Surface:* digest delivery buttons + one small table (or reuse `feedback` with a
`saved` verdict).
*Cost:* none beyond the existing digest.

### B5. Reminders with natural recurrence + snooze

When the reminders slice is built, include from the start: natural-language recurrence
("every other Thursday"), **snooze buttons on the delivery message** (10m / 1h /
tomorrow), and "what reminders do I have?". Snooze-on-delivery is the difference
between a reminder feature that gets used and one that gets abandoned.
*Cost:* parse-time only (one cheap-tier call to normalize the schedule); delivery is
template-rendered.

---

## C. New ideas (post-v1 candidates)

Ordered roughly by value-for-effort within the project's identity.

### C1. Morning briefing — one message, everything proactive

Once digest + reminders + usage report all exist, they arrive as separate pings.
Compose them into a single ~07:00 **briefing**: today's reminders, the YouTube digest,
(phase 2: overnight important mail), yesterday's spend one-liner. One message instead
of three is calmer and reads exactly like a chief of staff.
*Surface:* scheduler-level composition; each capability contributes a section.
*Cost:* assembly is free; sections are already budgeted individually.

### C2. Weekly memory & profile digest ("here's what I learned about you")

A weekly proactive note: memories added/updated, profile evolutions from feedback,
each with one-tap "wrong, forget it" buttons. Turns the *inspectable memory* promise
from pull ("what do you remember?") into push, and catches bad inferences early —
which matters more as `source: inferred` memories grow.
*Cost:* one cheap-tier summarization call per week; capped and skippable under
degradation.

### C3. Standing searches / topic watchers (bounded, digest-delivered)

"Keep an eye on new videos about X" — a named watcher whose hits are folded **into the
existing digest** rather than pinged immediately (stays within bounded proactivity).
v1 scope: YouTube subscriptions matching only (no extra quota); later the same
primitive covers mail rules and (if ever) web watchers. Watchers are listed, edited,
and deleted in chat.
*Surface:* one `watchers` table + a stage-1 filter extension.
*Cost:* rides the digest's existing stage-1 budget; each watcher adds prompt tokens,
so cap the count (e.g. 5).

### C4. Cost-aware model routing v2 — per-task tier overrides

Today `model_tier` is global per user (auto/cheap/premium). A natural refinement:
per-task-type overrides ("always use cheap for the digest, premium for chat"),
stored as a small jsonb on `settings`, resolved in `resolveTier`. The `llm_usage`
ledger already tracks `task_type`, so the spend report can show what each task type
costs on each tier — letting the user *see* the tradeoff they're tuning.
*Cost:* this is the feature that reduces cost.

### C5. Voice notes in, voice out (Discord-native)

Discord mobile makes voice messages one tap. Accept voice notes (transcribe via a
cheap STT model), answer in text; optionally read long answers back as an audio
attachment. This is a big mobile-UX unlock for a chat-native assistant and stays
within the one-agent model.
*Cost:* STT per note — meter it through the same `llm_usage` ledger with task_type
`stt`, subject to the same caps/degradation. Skip TTS under budget pressure.

### C6. Export & data portability

`!export memories` / `!export chat` producing a JSON/Markdown attachment. Cheap
(retrieval + file attach), reinforces the "your data, inspectable" identity, and is a
prerequisite for comfortable long-term use. Household phase makes this per-user.
*Cost:* none.

### C7. Household onboarding flow *(pairs with phase 3)*

The schema is household-ready but there's no *flow*: when a new member's first message
arrives, greet them, run the same conversational onboarding used for the owner's
interest profile, and notify the owner. Combined with the existing
`settings_permissions` allow-list, this makes "add my partner" a zero-admin act.
*Surface:* JIT-provisioning hook in `discord/handleMessage.ts` + onboarding
conversation state.
*Cost:* onboarding conversation is normal metered chat, attributed to the new user.

### C8. Web read-only dashboard (phase 3, as scoped)

Already on the roadmap; noting the highest-value *first* page from this review's
perspective: the **cost dashboard** (spend over time by task/model, budget burn-down),
because it's pure read of `llm_usage`/`budget_config` and needs no write path, making
it the safest first homectl-auth integration.

---

## Explicitly not suggested

- **Anything scraping YouTube** (recommendations sidebar, watch history) — ruled out
  in [`concept.md`](concept.md) on ToS grounds; nothing here reopens it.
- **Open-ended proactive pings** ("the AI decided to message you") — bounded
  proactivity stays; every proactive lane above is a defined, toggleable capability.
- **Multi-provider LLM routing** — the single-provider-behind-an-interface decision
  is locked and sufficient; C4 tunes *tiers*, not providers.

## Suggested shortlist

If picking three to do next alongside the digest slice: **A1 (slash commands)**,
**A4 (memory pin/edit)**, and **B1 (end-of-day report)** — all small, all compounding
trust in the core loops (control, memory, cost) that everything later builds on.
