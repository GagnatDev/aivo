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
/** Which tier a model fills, or null when it is configured but inactive. */
export type ModelTierRole = "cheap" | "premium";
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
export type DigestStatus = "pending" | "delivered" | "skipped_budget";
/** Whether a digest entry is a ranked pick or a rejected-list row. */
export type DigestItemKind = "pick" | "reject";
/** The USER's feedback vocabulary on delivered items (buttons + freeform replies). */
export type FeedbackSignal = "keep" | "drop" | "too_long" | "wrong_topic" | "freeform";
/** Lifecycle of a reminder; a snooze moves a delivered row back to pending. */
export type ReminderStatus = "pending" | "delivered" | "cancelled";
