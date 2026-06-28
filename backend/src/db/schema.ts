import type { ColumnType, Generated } from "kysely";

// Defaulted timestamp: selected as Date, never written by app code.
type DefaultTimestamp = ColumnType<Date, never, never>;
// Like DefaultTimestamp but app code may set it on write (e.g. updated_at = now()).
type UpdatableTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/** The per-capability channel a conversation belongs to (see docs/concept.md). */
export type Channel = "chat" | "youtube" | "mail";
/** Message author role. */
export type MessageRole = "user" | "assistant" | "tool" | "system";

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

export interface Database {
  users: UsersTable;
  conversations: ConversationsTable;
  messages: MessagesTable;
}
