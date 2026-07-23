# aivo — Data Model (Draft)

> Status: **reviewed — decisions locked** (technical pass). Companion to
> [`concept.md`](concept.md), [`technical-overview.md`](technical-overview.md),
> and [`deployment.md`](deployment.md). Nothing here is built yet — this is a
> proposed schema to react to.

## Approach

- **Storage:** the shared homectl Postgres 17 instance, a dedicated database +
  user `aivo` (provisioned by the Terraform `applications` map — see
  [`deployment.md`](deployment.md)). No object storage bucket in v1 (YouTube
  thumbnails are hotlinked).
- **Access layer:** `pg` Pool + typed **Kysely**, plain-SQL migrations run at
  boot (homectl pattern #3). Schema types live in `backend/src/db/schema.ts`.
- **Identity seam:** v1 is Discord-only, so a user is keyed by their Discord
  user id. We keep a nullable `auth_sub` column so homectl-auth (and a later web
  dashboard) can attach without a migration — this is the same JIT-user seam
  `workbench` uses, minus the OAuth flow for now.
- **YouTube is single-account, owner-scoped — not per-user.** Unlike memory,
  reminders, conversations, settings, and budget (all per-user / household-ready),
  the YouTube capability is one connected account (one OAuth token, one
  subscription firehose) whose digest belongs to the `is_owner` user. The data
  layer (`youtube_account`, `youtube_channels`, `videos`) carries no `user_id`;
  the output layer (`youtube_interest` profile, `digests`, related `feedback`) is
  the owner's. There is no per-user subscriptions join.
- **Conventions:** `snake_case` columns, `uuid` primary keys (server-generated)
  except where an external id is the natural key, `timestamptz` everywhere,
  `created_at` / `updated_at` on mutable rows. JSON payloads validated with Zod
  in app code, not the DB.

## Entity-relationship overview

```mermaid
erDiagram
  users ||--o{ memories : has
  users ||--o{ profiles : has
  users ||--o{ conversations : has
  conversations ||--o{ messages : contains
  users ||--o{ digests : "receives (owner only)"
  digests ||--o{ digest_items : contains
  videos ||--o{ digest_items : appears_in
  youtube_account ||--o{ youtube_channels : subscribes_to
  youtube_channels ||--o{ videos : publishes
  digest_items ||--o{ feedback : draws
  users ||--o{ feedback : gives
  users ||--o{ reminders : sets
  users ||--o{ llm_usage : incurs
  users ||--|| budget_config : configures
  users ||--|| settings : configures
```

## Tables

### `users`
The household-ready identity row. v1 has exactly one, but every other table
keys off `users.id` so members can be added later without redesign.

- `id` uuid pk
- `discord_user_id` text unique not null — the v1 identity
- `auth_sub` text unique null — reserved for homectl-auth (phase 3)
- `display_name` text
- `is_owner` boolean default false — distinguishes the primary user early on
- `created_at`, `updated_at` timestamptz

> Provisioned just-in-time: on the first message from an unknown Discord id,
> upsert a row (mirrors `workbench`'s `upsertByAuthSub`).

### `settings`
Per-user, chat-editable knobs (one row per user).

- `user_id` uuid pk → users
- `digest_hour` int default 7, `timezone` text default `Europe/Oslo`
- `digest_cap` int default 8 — ranked picks cap; chat-adjustable within the concept's
  ~8–10 range (default sits at the low end)
- `model_tier` text default `auto` — `auto` | `cheap` | `premium` (the chat
  override "use the cheap model for everything this week")
- `persona_prompt` text null — editable system-prompt addendum ("be more casual")
- `proactivity` jsonb — per-lane proactive state (digest lane; weather morning-report lane)
- `created_at`, `updated_at` timestamptz

### `memories`
The persistent, **inspectable** memory ("what do you remember about me?" /
"forget that"). The interest/importance profiles are higher-level summaries
derived alongside this.

- `id` uuid pk
- `user_id` uuid → users
- `category` text — e.g. `preference`, `fact`, `context`
- `content` text not null — human-readable
- `source` text — `onboarding` | `chat` | `feedback` | `inferred`
- `embedding` vector null — optional, only if we enable semantic recall (pgvector)
- `pinned` boolean default false, `forgotten_at` timestamptz null — soft-delete so
  "forget that" is reversible and auditable
- `created_at`, `updated_at`

### `profiles`
Versioned natural-language profiles (the YouTube interest profile; later the mail
importance profile). Human-readable and chat-editable; kept versioned so feedback
evolution is traceable.

- `id` uuid pk
- `user_id` uuid → users
- `kind` text — `youtube_interest` | `mail_importance`
- `body` text not null — the editable NL profile
- `version` int — incremented on each material update
- `is_current` boolean — exactly one current per (user, kind)
- `created_at`

> `kind=youtube_interest` is **owner-scoped (permanent)**: exactly one current row,
> owned by the `is_owner` user (YouTube is a single-account capability and stays that
> way). `mail_importance` (phase 2) may legitimately be per-user, which is why this
> table stays user-keyed.

### `conversations` / `messages`
Chat context per channel, enough to give the agent memory of the running thread
and to attribute spend.

`conversations`
- `id` uuid pk, `user_id` uuid → users
- `channel` text — `chat` | `youtube` | `mail` (the per-capability channels from
  [`concept.md`](concept.md); `mail` is phase 2)
- `discord_channel_id` text
- `created_at`, `last_message_at`

`messages`
- `id` uuid pk, `conversation_id` uuid → conversations
- `role` text — `user` | `assistant` | `tool` | `system`
- `discord_message_id` text null — links assistant output to a Discord message
  (needed to attach reaction buttons / edit later)
- `content` text
- `tokens_in` int null, `tokens_out` int null — denormalized convenience copy for
  showing per-message size in context; **`llm_usage` is the authoritative cost/token
  ledger** (these may be null, e.g. inbound user messages, and must never be summed for
  billing)
- `created_at`

### `youtube_account`
The **single connected YouTube account** whose subscriptions feed the digest.
Always exactly one row — YouTube is a single-account, owner-scoped capability, not
a per-user one (only the connected account exists; there is no per-user fan-out).

- `id` smallint pk default 1 — singleton guard (one row)
- `youtube_channel_id` text — the connected account's own channel id
- `title` text
- `connected_by_user_id` uuid null → users — the owner who linked it (attribution
  only; the capability is account-scoped, not user-scoped)
- `subscriptions_synced_at` timestamptz null — last subscription-list refresh
- `videos_polled_at` timestamptz null — last new-video poll watermark
- `created_at`, `updated_at`

> The OAuth refresh token lives in `aivo-secrets` (see
> [`deployment.md`](deployment.md)), **not** in the DB; this row is metadata +
> sync watermarks only.

### `youtube_channels`
Cache of the connected account's channels. v1 is subscriptions-only, so every
cached channel is (or was) a subscription of the single connected account.

- `id` text pk — YouTube channel id
- `title` text, `thumbnail_url` text
- `subscribed` boolean default true — currently in the account's subscription list
- `subscribed_at` timestamptz, `unsubscribed_at` timestamptz null — keep historical
  channels (still referenced by old `videos`/`digest_items`) after an unsubscribe
- `muted` boolean default false — from feedback ("stop showing me X channel")
- `last_seen_at` timestamptz

### `videos`
Candidate videos discovered from subscriptions, carrying both filter stages.

- `id` text pk — YouTube video id
- `channel_id` text → youtube_channels
- `title` text, `description` text, `duration_seconds` int
- `published_at` timestamptz, `thumbnail_url` text
- `stage1_score` real null, `stage1_at` timestamptz null
- `transcript_status` text — `none` | `fetched` | `unavailable`
- `stage2_decision` text null — `pick` | `reject` (same vocabulary as
  `digest_items.kind`; see the terminology note in [Cross-cutting notes](#cross-cutting-notes))
- `summary` text null — the 2–3 bullet TL;DW (from stage-2 transcript)
- `why` text null — one-line "why you're seeing this"
- `created_at`

### `digests` / `digest_items`
A digest run and its entries. `digest_items` distinguishes **picks** from the
**rejected list** (with reasons) that drives cold-start boundary calibration.

> Owner-scoped (permanent): the YouTube lane (`digests`, `digest_items`, and the
> `feedback` drawn from them) always references the `is_owner` user. The `user_id`
> column is kept for schema uniformity, not because YouTube fans out per user.

`digests`
- `id` uuid pk, `user_id` uuid → users
- `run_date` date, `status` text — `pending` | `delivered` | `skipped_budget`
- `covers_since` timestamptz — watermark of "new since last digest"
- `delivered_at` timestamptz null
- `cost_cents` numeric(12,4) default 0 — fractional cents, summed from this run's
  `llm_usage` rows (see the cents-precision note in [Cross-cutting notes](#cross-cutting-notes))

`digest_items`
- `id` uuid pk, `digest_id` uuid → digests, `video_id` text → videos
- `kind` text — `pick` | `reject`
- `rank` int null — for picks
- `reason` text null — for rejects ("skipped: news recap, you said no")
- `confidence` real null

### `feedback`
Reactions + freeform replies folded back into profiles/memory. Both the button
signals (keep/drop, too long, wrong topic) and NL replies land here.

- `id` uuid pk, `user_id` uuid → users
- `digest_item_id` uuid null → digest_items — null for global feedback
- `signal` text — `keep` | `drop` | `too_long` | `wrong_topic` | `freeform`
- `freeform_text` text null
- `applied` boolean default false — set once folded into a profile/memory update
- `created_at`

### `reminders`
User-set reminders delivered proactively.

- `id` uuid pk, `user_id` uuid → users
- `text` text, `due_at` timestamptz
- `status` text — `pending` | `delivered` | `cancelled`
- `delivered_at` timestamptz null
- `created_at`

### `weather_locations`
Per-user saved weather locations (MET Norway / yr.no). A place named once and resolved
to coordinates via the geocoder, so repeat forecasts and the morning report skip the name
lookup. Added after the initial schema (migration 023).

- `id` uuid pk, `user_id` uuid → users
- `name` text — the label the user refers to it by; unique per user, case-insensitively
- `display_name` text null — the geocoder's full resolved name
- `latitude` / `longitude` double precision
- `is_home` boolean — the one location the daily morning report reads (partial unique
  index enforces at most one home per user)
- `created_at` / `updated_at`

The morning report's schedule lives in the `weather` lane of `settings.proactivity`
(enabled, report_hour, last_report_date watermark, run_requested_at) — a sibling of the
digest lane, owner-scoped and delivered by the scheduler tick.

### `llm_usage`
Per-call cost ledger — the basis for budget caps, alerts, and usage reports.
(All variable cost is LLM tokens; this is the cost-control source of truth.)

- `id` uuid pk, `user_id` uuid → users
- `task_type` text — `chat` | `stage1_rank` | `stage2_summary` | `onboarding` |
  `mail_classify` (phase 2)
- `model` text, `tokens_in` int, `tokens_out` int
- `cost_cents` numeric(12,4) — fractional cents (a single cheap call can cost a
  fraction of a cent); see the cents-precision note in [Cross-cutting notes](#cross-cutting-notes)
- `created_at` timestamptz
- indexed on (`user_id`, `created_at`) for daily/monthly rollups

### `budget_config`
Per-user budget settings (one row per user).

- `user_id` uuid pk → users
- `monthly_ceiling_cents` int — hard ceiling (whole cents)
- `daily_soft_cap_cents` int null — whole cents
- `approval_threshold_cents` int null — the per-request approval gate: a single
  on-demand request whose **estimated** cost exceeds this is confirmed before running
  (concept's "approval gate for expensive one-offs"); null disables the gate
- `alert_thresholds` jsonb default `[50,80,100]` — percent-of-ceiling alert points
- `degradation_state` text — `normal` | `cheap_models` | `proactive_paused` |
  `over_ceiling` (see the degradation note below)
- `created_at`, `updated_at`

> Daily/month-to-date spend is **derived** from `llm_usage` (a view or rollup),
> not stored, so reports and threshold checks can't drift from the ledger.

> **`degradation_state` ↔ concept stages.** `alert_thresholds` only *notify*; the
> state machine is what changes behavior: `normal` → `cheap_models` (drop to cheaper
> models + shorter summaries, triggered around the daily soft cap / upper alert
> thresholds) → `proactive_paused` (pause digests + other proactive work) →
> `over_ceiling` (monthly hard ceiling reached: keep answering direct chat only, with
> an "over budget" note, per the concept's "never goes fully dark"). The exact
> threshold→state thresholds are app config, not stored per-row.

## Cross-cutting notes

- **The learning loop** (`videos.stage1_score` → `digest_items` picks/rejects →
  `feedback` → `profiles`/`memories` → next run's stage-1 ranking) is the whole
  point; the rejected list auto-tapers as agreement rises, which is a query over
  recent `feedback` agreement rate, not a stored flag.
- **YouTube is a single connected account, owner-scoped.** `youtube_account` is a
  singleton; `youtube_channels`/`videos` are a shared cache with no `user_id`; the
  interest profile, digest, and feedback belong to the `is_owner` user. App code
  enforces the owner invariant — the per-user identity model deliberately does
  **not** extend to YouTube (permanently, not just in v1).
- **No FKs to YouTube ids across user data** beyond the cache tables; the video
  cache can be pruned independently of digests (keep `videos` rows referenced by
  any `digest_item`).
- **Soft deletes** for `memories` ("forget") and `reminders`/`digests`
  (`status`) keep the agent's actions auditable and reversible.
- **pgvector is optional** — only add the `embedding` column + extension if we
  decide semantic memory recall beats keyword/recency retrieval in v1.
- **Decision vocabulary (two distinct layers).** The *system's* relevance verdict is
  `pick | reject` (`videos.stage2_decision`, `digest_items.kind`). The *user's*
  feedback on a delivered item is `keep | drop` (`feedback.signal`, matching the
  concept's buttons) plus `too_long | wrong_topic | freeform`. "pick/reject" = what the
  agent decided; "keep/drop" = whether you agreed. Don't mix the two sets.
- **Money is fractional cents in the ledger, whole cents in caps.** Per-call/per-run
  costs (`llm_usage.cost_cents`, `digests.cost_cents`) are `numeric(12,4)` so a
  sub-cent call isn't rounded to zero. User-facing limits (`monthly_ceiling_cents`,
  `daily_soft_cap_cents`, `approval_threshold_cents`) are whole-cent `int`. Checks sum
  the fractional ledger and compare against the integer cap; round only at display.

## Decisions (locked)

- **Semantic memory:** start simple — category + recency + keyword retrieval in v1.
  The `memories.embedding` column stays reserved; add the pgvector extension +
  backfill only if recall quality demands it later.
- **History retention:** retain full `conversations`/`messages` history in v1
  (trivial volume for one user, aids early debugging of the agent). Add roll-up into
  `memories` + pruning before household lands.
- **Budget granularity:** per-user as designed — one `budget_config` row for the
  owner in v1; members get their own caps when household lands. Shared YouTube digest
  cost is attributed to the owner (consistent with YouTube being owner-scoped). No
  schema change needed.
- **YouTube stays single-account (permanent):** the digest is always driven by the
  one owner-connected account — there is no plan to add a second connected account or
  per-user YouTube fan-out, even after household lands. This is why `youtube_account`
  is a permanent singleton and `youtube_channels`/`videos` carry no account id: there
  is only ever one subscription firehose to cache. Household members share the owner's
  digest (or simply don't use the YouTube lane); their per-user data is memory,
  reminders, conversations, settings, budget, and the phase-2 mail profile.
