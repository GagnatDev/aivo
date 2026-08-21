import type { z } from "zod";
import type { Language } from "../../i18n/index.js";
import type { ToolSchema } from "../../llm/provider.js";
import type { Tier } from "../budget.js";
import type { AgentDeps } from "../deps.js";
import { gateMatches } from "./gate.js";
import { memoryTool } from "./memory.js";
import { budgetTool } from "./budget.js";
import { modelsTool } from "./models.js";
import { remindersTool } from "./reminders.js";
import { settingsTool } from "./settings.js";
import { unforkedTool } from "./unforked.js";
import { weatherTool } from "./weather.js";
import { youtubeDigestTool } from "./youtubeDigest.js";
import { youtubeSummaryTool } from "./youtubeSummary.js";

/** The execution context handed to every tool. `isOwner` is the security boundary. */
export interface ToolContext {
  deps: AgentDeps;
  userId: string;
  /** Derived server-side from users.is_owner — never from model output. */
  isOwner: boolean;
  conversationId: string;
  /** The user's preferred language, for the turn-level fallbacks the loop may emit. */
  language: Language;
}

export interface AgentTool {
  schema: ToolSchema;
  /**
   * Trigger keywords deciding whether this tool's schema is advertised this turn — but
   * ONLY when keyword gating is enabled (`AGENT_TOOL_KEYWORD_GATING`, off by default;
   * see {@link selectToolSchemas} and {@link gateMatches} for the matching rules). With
   * gating off every schema is advertised and this field is inert. A tool with no gate
   * is always advertised even when gating is on. Kept next to the tool definition so a
   * tool and its gate can't drift apart. List both English and Norwegian triggers — the
   * owner switches languages freely, and a missed word silently strips the capability.
   */
  gate?: readonly string[];
  /** Execute the call and return a result string appended as a `tool` message. */
  execute(args: unknown, ctx: ToolContext): Promise<string>;
}

/** Standard refusal when a non-owner attempts an owner-only action. */
export const OWNER_ONLY = "Refused: only the owner can do that.";

/** Parse args with a Zod schema, returning a tagged error the model can recover from. */
export function parse<T>(
  schema: z.ZodType<T>,
  args: unknown,
): { ok: true; value: T } | { ok: false; error: string } {
  const result = schema.safeParse(args);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: `Invalid arguments: ${result.error.issues.map((i) => i.message).join("; ")}`,
  };
}

/** Build the tool registry the agent exposes (memory, budget, models, settings, youtube_digest, youtube_summary, reminder, unforked, weather). */
export function buildToolRegistry(): AgentTool[] {
  return [
    memoryTool,
    budgetTool,
    modelsTool,
    settingsTool,
    youtubeDigestTool,
    youtubeSummaryTool,
    remindersTool,
    unforkedTool,
    weatherTool,
  ];
}

/** How {@link selectToolSchemas} decides what to advertise this turn. */
export interface ToolGating {
  /**
   * Keyword-gate advertisement (`AGENT_TOOL_KEYWORD_GATING`). Off by default: every
   * schema is advertised every turn, so the toolset is a stable prompt prefix (caches
   * well) and a capability can never be silently stripped by a missed keyword — the
   * "call this when…" guidance in each description does the triggering work instead.
   * Flip on to trade that robustness for a smaller per-call prompt (~1-2k input tokens).
   */
  enabled: boolean;
  /** Recent conversation text scanned for trigger keywords (only read when enabled). */
  recentText: string;
}

/**
 * Pick which tool schemas to advertise this turn. The full registry is still used to
 * *execute* whatever the model calls; this only controls what the model is shown.
 *
 * With gating disabled (the default — see {@link ToolGating}) the whole registry is
 * advertised. With it enabled, gated tools are advertised only when the recent
 * conversation trips one of their keywords (see {@link gateMatches} — exact/stem/fuzzy,
 * so a typo or a garbled transcription still matches); matching is deliberately broad
 * and biased toward inclusion — a false positive just wastes tokens, a false negative
 * loses a capability for that turn. A tool with no `gate` is always advertised —
 * `memory` is intentionally un-gated: aivo is meant to capture facts the user drops in
 * ordinary conversation ("I'm vegetarian") without a trigger word, so gating it out
 * would silently lose recall.
 *
 * When gating is on, the model can only *call* a tool whose schema was advertised, so a
 * gate that misses the user's phrasing silently strips the capability (the model just
 * replies in prose). The owner writes in Norwegian as often as English, so every gate is
 * bilingual: it lists both English and Norwegian trigger words. New tools MUST do the
 * same while gating remains available, or they'll be dead for non-English turns.
 */
export function selectToolSchemas(registry: AgentTool[], gating: ToolGating): ToolSchema[] {
  if (!gating.enabled) return registry.map((t) => t.schema);
  return registry
    .filter((t) => (t.gate ? gateMatches(t.gate, gating.recentText) : true))
    .map((t) => t.schema);
}

/** Resolve a tier setting/string to a concrete cheap|premium tier. `auto` → premium. */
export function resolveTier(modelTier: string): Tier {
  if (modelTier === "cheap") return "cheap";
  if (modelTier === "premium") return "premium";
  return "premium"; // auto: premium for real conversation (cheap is for ranking/classification)
}
