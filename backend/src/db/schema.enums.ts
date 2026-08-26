// Hand-authored enum/alias types layered onto the generated schema.
//
// `db/schema.ts` is generated from the migrated database by `pnpm db:codegen`
// (see docs/architecture-improvements.md §1.10) and MUST NOT be edited by hand.
// The generator cannot recover string-literal unions from plain `TEXT` columns,
// so those live here and are wired back onto their columns via the codegen
// `overrides`/`customImports` config in `db/codegen.ts`. App code imports these
// names from this file, not from the generated `schema.ts`.

/** The per-capability channel a conversation belongs to (see docs/concept.md). */
export type Channel = "chat" | "youtube" | "mail";
/** Message author role. */
export type MessageRole = "user" | "assistant" | "tool" | "system";
/**
 * A tool call recorded on an assistant message (`messages.tool_calls`), mirroring the
 * provider-agnostic `ToolCall` in llm/provider.ts — mirrored rather than imported so
 * `db/` stays at the edge of the layering (nothing in db/ reaches up into llm/).
 */
export interface StoredToolCall {
  id: string;
  name: string;
  /** Raw JSON string, exactly as the model produced it. */
  arguments: string;
}
/** Which tier a model fills, or null when it is configured but inactive. */
export type ModelTierRole = "cheap" | "premium";
/** What a model can do — the modality axis, orthogonal to the cheap/premium cost tier. */
export type ModelCapability = "chat" | "audio" | "vision";
/** The cost-control behavior state machine (see docs/data-model.md). */
export type DegradationState = "normal" | "cheap_models" | "proactive_paused" | "over_ceiling";
/** Lifecycle of an interactive approval-gate prompt. */
export type ApprovalStatus = "pending" | "approved" | "cancelled" | "expired";
/** Which natural-language profile a `profiles` row holds (mail_importance is phase 2). */
export type ProfileKind = "youtube_interest" | "mail_importance";
/** Whether a video's caption track was fetched for stage 2 (see docs/data-model.md). */
export type TranscriptStatus = "none" | "fetched" | "unavailable";
/** The SYSTEM's stage-2 relevance verdict — distinct from the user's keep/drop feedback. */
export type Stage2Decision = "pick" | "reject";
/** Lifecycle of a digest run. */
export type DigestStatus = "pending" | "delivered" | "skipped_budget" | "failed";
/**
 * Why a digest run ended up `failed` — the coarse classification the Discord and
 * dashboard layers switch on to phrase a message (see digest/failure.ts). `youtube_auth`
 * is called out separately from `youtube_api` because only it needs the owner to act
 * (re-authorize and swap the refresh token); the rest is worth retrying on its own.
 */
export type DigestFailureKind = "youtube_auth" | "youtube_api" | "llm" | "unknown";
/** Whether a digest entry is a ranked pick or a rejected-list row. */
export type DigestItemKind = "pick" | "reject";
/** The USER's feedback vocabulary on delivered items (buttons + freeform replies). */
export type FeedbackSignal = "keep" | "drop" | "too_long" | "wrong_topic" | "freeform";
/** Lifecycle of a reminder; a snooze moves a delivered row back to pending. */
export type ReminderStatus = "pending" | "delivered" | "cancelled";
/**
 * How an agent turn ended, as recorded in `turn_summaries.outcome` — mirrors the
 * agent loop's exit paths (agent/toolLoop.ts re-exports this name).
 */
export type TurnOutcome =
  | "final_answer"
  | "forced_answer"
  | "iteration_cap"
  | "cost_ceiling"
  | "provider_error"
  | "aborted";
/**
 * One model round-trip's stop reason, as recorded in `turn_summaries.finish_reasons`.
 * Mirrors `FinishReason` in llm/provider.ts rather than importing it, for the same
 * reason {@link StoredToolCall} does: `db/` stays at the edge of the layering.
 */
export type StoredFinishReason = "stop" | "length" | "tool_calls" | "other";
