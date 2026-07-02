import type { z } from "zod";
import type { ToolSchema } from "../../llm/provider.js";
import type { Tier } from "../budget.js";
import type { AgentDeps } from "../deps.js";
import { memoryTool } from "./memory.js";
import { budgetTool } from "./budget.js";
import { modelsTool } from "./models.js";
import { settingsTool } from "./settings.js";

/** The execution context handed to every tool. `isOwner` is the security boundary. */
export interface ToolContext {
  deps: AgentDeps;
  userId: string;
  /** Derived server-side from users.is_owner — never from model output. */
  isOwner: boolean;
  conversationId: string;
}

export interface AgentTool {
  schema: ToolSchema;
  /**
   * Keyword gate deciding whether this tool's schema is advertised this turn (see
   * {@link selectToolSchemas}). A tool with no gate is always advertised. Kept next to
   * the tool definition so a tool and its gate can't drift apart.
   */
  gate?: RegExp;
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

/** Build the tool registry the agent exposes (memory, budget, models, settings). */
export function buildToolRegistry(): AgentTool[] {
  return [memoryTool, budgetTool, modelsTool, settingsTool];
}

/**
 * Pick which tool schemas to advertise this turn from the recent conversation text. The
 * full registry is still used to *execute* whatever the model calls; this only controls
 * what the model is shown, to keep the per-call prompt small (the 4 schemas are ~1.1k
 * tokens sent on every call). Scanning a few recent messages — not just the latest —
 * keeps a tool on across an immediate follow-up ("actually make it $30").
 *
 * A tool with no `gate` is always advertised — `memory` is intentionally un-gated: aivo
 * is meant to capture facts the user drops in ordinary conversation ("I'm vegetarian")
 * without a trigger word, so gating it out would silently lose recall. Gated tools are
 * advertised only when the recent conversation matches their keyword regex; matching is
 * deliberately broad and biased toward inclusion — a false positive just wastes tokens,
 * a false negative loses a capability for that turn.
 */
export function selectToolSchemas(registry: AgentTool[], recentText: string): ToolSchema[] {
  return registry.filter((t) => (t.gate ? t.gate.test(recentText) : true)).map((t) => t.schema);
}

/** Resolve a tier setting/string to a concrete cheap|premium tier. `auto` → premium. */
export function resolveTier(modelTier: string): Tier {
  if (modelTier === "cheap") return "cheap";
  if (modelTier === "premium") return "premium";
  return "premium"; // auto: premium for real conversation (cheap is for ranking/classification)
}
