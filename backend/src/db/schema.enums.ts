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
