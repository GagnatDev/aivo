import { ConfigError } from "../llm/errors.js";
import { logger } from "../logger.js";
import type { Tier } from "./budget.js";
import type { AgentDeps } from "./deps.js";

/**
 * Resolve the model id for a tier, falling back to the other tier if unconfigured.
 * Throws {@link ConfigError} when neither tier has a model — the config boundary is
 * where that fact is known, so it's raised as a typed error rather than a bare null.
 * Lives in its own module (rather than prepareTurn.ts, its original home) because
 * tools that make their own LLM sub-calls need it too, and prepareTurn imports the
 * tool registry — importing back from a tool would be a cycle.
 */
export async function resolveModel(deps: AgentDeps, tier: Tier): Promise<string> {
  const row = await deps.modelPricing.getByTier(tier);
  if (row) return row.model_id;
  const fallbackTier = tier === "cheap" ? "premium" : "cheap";
  const fallback = await deps.modelPricing.getByTier(fallbackTier);
  if (fallback) {
    // No model fills the requested slot — running on the wrong tier degrades quality
    // silently, so make it loud. Usually means the slot was never (re)assigned.
    logger.warn(
      { requestedTier: tier, fallbackModel: fallback.model_id, fallbackTier },
      "no model configured for requested tier; falling back",
    );
    return fallback.model_id;
  }
  throw new ConfigError("no model configured for any tier");
}
