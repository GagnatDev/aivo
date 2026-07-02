import type { ColumnType, Generated } from "kysely";

// Defaulted timestamp: selected as Date, never written by app code.
type DefaultTimestamp = ColumnType<Date, never, never>;
// Like DefaultTimestamp but app code may set it on write (e.g. updated_at = now()).
type UpdatableTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

// Postgres returns `numeric` as a string to preserve precision; allow writing it as
// a string or number, always read it as a string, and parse with Number() only at
// compute/display time (money convention — see docs/data-model.md).
type Numeric = ColumnType<string, string | number, string | number>;

/** The per-capability channel a conversation belongs to (see docs/concept.md). */
export type Channel = "chat" | "youtube" | "mail";
/** Message author role. */
export type MessageRole = "user" | "assistant" | "tool" | "system";
/** Which tier a model fills, or null when it is configured but inactive. */
export type ModelTierRole = "cheap" | "premium";
/** The cost-control behavior state machine (see docs/data-model.md). */
export type DegradationState = "normal" | "cheap_models" | "proactive_paused" | "over_ceiling";
/** Lifecycle of an interactive approval-gate prompt. */
export type ApprovalStatus = "pending" | "approved" | "cancelled" | "expired";

/**
 * Household-ready identity. v1 keys off `discord_user_id` (provisioned just-in-time
 * on a person's first message — see storage/userRepository.ts). `auth_sub` is a
 * reserved, nullable seam so homectl-auth + a web dashboard can attach later
 * without a migration. Every other table scopes by `users.id`.
 */
export interface UsersTable {
  id: Generated<string>;
  discord_user_id: string;
  /** Reserved for homectl-auth (phase 3); null in v1. */
  auth_sub: string | null;
  display_name: string | null;
  is_owner: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: DefaultTimestamp;
  updated_at: UpdatableTimestamp;
}

/**
 * Chat context per channel. v1 has one row per (user, channel) — enough to give the
 * agent memory of the running thread and to attribute spend later.
 */
export interface ConversationsTable {
  id: Generated<string>;
  user_id: string;
  channel: Channel;
  discord_channel_id: string | null;
  created_at: DefaultTimestamp;
  last_message_at: UpdatableTimestamp;
}

/**
 * Messages within a conversation. `discord_message_id` links assistant output back
 * to the Discord message (needed later to attach reaction buttons / edit).
 * `tokens_in`/`tokens_out` are a denormalized convenience copy only — `llm_usage`
 * (a later slice) is the authoritative cost/token ledger.
 */
export interface MessagesTable {
  id: Generated<string>;
  conversation_id: string;
  role: MessageRole;
  discord_message_id: string | null;
  content: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: DefaultTimestamp;
}

/**
 * The persistent, inspectable memory the agent writes via the memory tool.
 * `forgotten_at` is a soft-delete so "forget that" is reversible; the active set is
 * everything with `forgotten_at IS NULL`.
 */
export interface MemoriesTable {
  id: Generated<string>;
  user_id: string;
  category: string | null;
  content: string;
  source: string | null;
  pinned: ColumnType<boolean, boolean | undefined, boolean>;
  forgotten_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  created_at: DefaultTimestamp;
  updated_at: UpdatableTimestamp;
}

/**
 * Per-user, chat-editable knobs. v1 reads only `model_tier` + `persona_prompt`; the
 * rest are reserved with their defaults for later slices. Provisioned just-in-time.
 */
export interface SettingsTable {
  user_id: string;
  digest_hour: ColumnType<number, number | undefined, number>;
  timezone: ColumnType<string, string | undefined, string>;
  digest_cap: ColumnType<number, number | undefined, number>;
  model_tier: ColumnType<string, string | undefined, string>;
  persona_prompt: string | null;
  proactivity: ColumnType<Record<string, unknown>, string | undefined, string>;
  created_at: DefaultTimestamp;
  updated_at: UpdatableTimestamp;
}

/**
 * Owner-managed singleton (id = 1) holding the allow-list of `settings` column names
 * a non-owner user may edit. Consulted by the settings tool for non-owners.
 */
export interface SettingsPermissionsTable {
  id: ColumnType<number, number | undefined, never>;
  member_editable_keys: ColumnType<string[], string | undefined, string>;
  updated_at: UpdatableTimestamp;
}

/**
 * DB-backed model + pricing config. `tier_role` marks the active cheap/premium model.
 * Prices are cents per 1,000,000 tokens. Owner-only writes (enforced in the tool).
 */
export interface ModelPricingTable {
  id: Generated<string>;
  model_id: string;
  tier_role: ModelTierRole | null;
  input_cost_per_mtok_cents: Numeric;
  output_cost_per_mtok_cents: Numeric;
  currency: ColumnType<string, string | undefined, string>;
  active: ColumnType<boolean, boolean | undefined, boolean>;
  updated_at: UpdatableTimestamp;
}

/**
 * Per-call cost ledger — the authoritative source of truth for budget caps and
 * reports. `cost_cents` is fractional; derive spend by SUM, never store rollups.
 */
export interface LlmUsageTable {
  id: Generated<string>;
  user_id: string;
  task_type: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_cents: Numeric;
  created_at: DefaultTimestamp;
}

/**
 * Per-user budget settings. Caps are whole-cent ints; `degradation_state` is the
 * behavior state machine; `last_alerted_pct` debounces threshold alerts.
 */
export interface BudgetConfigTable {
  user_id: string;
  monthly_ceiling_cents: ColumnType<number, number | undefined, number>;
  daily_soft_cap_cents: number | null;
  approval_threshold_cents: number | null;
  alert_thresholds: ColumnType<number[], string | undefined, string>;
  degradation_state: ColumnType<DegradationState, string | undefined, string>;
  last_alerted_pct: ColumnType<number, number | undefined, number>;
  created_at: DefaultTimestamp;
  updated_at: UpdatableTimestamp;
}

/**
 * The interactive approval gate's durable state. Stores a conversation reference (not
 * a serialized request) so an approved operation rebuilds context on resume.
 */
export interface PendingApprovalsTable {
  id: Generated<string>;
  user_id: string;
  conversation_id: string;
  trigger_message_id: string;
  prompt_message_id: string | null;
  estimated_cost_cents: Numeric;
  task_type: string;
  status: ColumnType<ApprovalStatus, string | undefined, string>;
  created_at: DefaultTimestamp;
  resolved_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

export interface Database {
  users: UsersTable;
  conversations: ConversationsTable;
  messages: MessagesTable;
  memories: MemoriesTable;
  settings: SettingsTable;
  settings_permissions: SettingsPermissionsTable;
  model_pricing: ModelPricingTable;
  llm_usage: LlmUsageTable;
  budget_config: BudgetConfigTable;
  pending_approvals: PendingApprovalsTable;
}
